import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomInt,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { KioskDeviceDocument } from "@/lib/models";
import type { OutletSettingsDocument } from "@/lib/outlet-settings";
import { getFaceEncryptionKey } from "@/lib/face-templates";

export const KIOSK_SESSION_COOKIE = "attendance-kiosk-session";
export const KIOSK_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_PIN_ATTEMPTS_PER_WINDOW = 30;

let pinIndexesPromise: Promise<void> | undefined;

function getSigningSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret)
    throw new Error("AUTH_SECRET must be configured for kiosk PIN sessions.");
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", getSigningSecret())
    .update(value)
    .digest("base64url");
}

export function createKioskPin() {
  return String(randomInt(10_000_000, 100_000_000));
}

export function hashKioskPin(pin: string) {
  return createHmac("sha256", getSigningSecret())
    .update(`attendance-kiosk-pin-v1:${pin}`)
    .digest("hex");
}

export function encryptKioskPin(pin: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getFaceEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(pin, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptKioskPin(encrypted: {
  iv: string;
  authTag: string;
  ciphertext: string;
}) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getFaceEncryptionKey(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function createUniqueKioskPin(db: Db) {
  await ensureKioskPinIndexes(db);
  const devices = db.collection<KioskDeviceDocument>("kioskDevices");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pin = createKioskPin();
    const pinHash = hashKioskPin(pin);
    if (!(await devices.findOne({ pinHash }, { projection: { _id: 1 } })))
      return { pin, pinHash };
  }
  throw new Error("Unable to generate a unique kiosk PIN. Try again.");
}

export function createKioskSessionToken(
  deviceId: string,
  pinHash: string,
  expiresAt?: number,
) {
  const expiration =
    expiresAt ??
    Math.floor(Date.now() / 1000) + KIOSK_SESSION_MAX_AGE_SECONDS;
  const payload = Buffer.from(`${deviceId}.${pinHash}.${expiration}`).toString(
    "base64url",
  );
  return `${payload}.${sign(`attendance-kiosk-session-v1:${payload}`)}`;
}

export function getKioskSessionClaims(token: string | null | undefined) {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expected = Buffer.from(
    sign(`attendance-kiosk-session-v1:${payload}`),
    "base64url",
  );
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;

  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const [deviceId, pinHash, expiresAtText] = decoded.split(".");
    const expiresAt = Number(expiresAtText);
    if (
      !deviceId ||
      !pinHash ||
      !expiresAtText ||
      !/^[a-f\d]{24}$/i.test(deviceId) ||
      !/^[a-f\d]{64}$/i.test(pinHash) ||
      !Number.isInteger(expiresAt) ||
      expiresAt <= Math.floor(Date.now() / 1000)
    )
      return null;
    return { deviceId, pinHash };
  } catch {
    return null;
  }
}

export async function ensureKioskPinIndexes(db: Db) {
  if (!pinIndexesPromise) {
    pinIndexesPromise = Promise.all([
      db
        .collection<KioskDeviceDocument>("kioskDevices")
        .createIndex({ pinHash: 1 }, { unique: true, sparse: true }),
      db
        .collection("kioskPinAttempts")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ])
      .then(() => undefined)
      .catch((error: unknown) => {
        pinIndexesPromise = undefined;
        throw error;
      });
  }
  await pinIndexesPromise;
}

export async function consumeKioskPinAttempt(
  db: Db,
  request: Request,
): Promise<boolean> {
  await ensureKioskPinIndexes(db);
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp =
    request.headers.get("x-real-ip")?.trim() ||
    forwardedFor?.split(",").at(-1)?.trim() ||
    "unknown";
  const ipHash = createHmac("sha256", getSigningSecret())
    .update(`attendance-kiosk-pin-ip-v1:${clientIp}`)
    .digest("hex");
  const bucket = Math.floor(Date.now() / PIN_ATTEMPT_WINDOW_MS);
  const id = `${bucket}:${ipHash}`;
  const expiresAt = new Date((bucket + 1) * PIN_ATTEMPT_WINDOW_MS);
  const attempts = db.collection<{
    _id: string;
    attempts: number;
    expiresAt: Date;
  }>("kioskPinAttempts");
  await attempts.updateOne(
    { _id: id },
    { $inc: { attempts: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true },
  );
  const record = await attempts.findOne({ _id: id }, { projection: { attempts: 1 } });
  return (record?.attempts ?? 0) <= MAX_PIN_ATTEMPTS_PER_WINDOW;
}

function readSessionCookie(request: Request) {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  const entry = cookies.find((cookie) =>
    cookie.trim().startsWith(`${KIOSK_SESSION_COOKIE}=`),
  );
  return entry?.trim().slice(KIOSK_SESSION_COOKIE.length + 1) ?? null;
}

async function authorizeKioskDeviceLegacy(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(authorization);
  if (!match) return null;
  const tokenHash = createHash("sha256").update(match[1]).digest("hex");
  const db = await getDb();
  const devices = db.collection<KioskDeviceDocument>("kioskDevices");
  const device = await devices.findOne({ tokenHash, active: true });
  if (!device) return null;
  const outlet = await db
    .collection<OutletSettingsDocument>("outlets")
    .findOne({ _id: device.outletId, active: true }, { projection: { _id: 1 } });
  if (!outlet) return null;
  await devices.updateOne(
    { _id: device._id, active: true },
    { $set: { lastUsedAt: new Date() } },
  );
  return device;
}

export async function authorizeKioskDevice(request: Request) {
  const session = getKioskSessionClaims(readSessionCookie(request));
  if (!session) return authorizeKioskDeviceLegacy(request);

  const db = await getDb();
  const devices = db.collection<KioskDeviceDocument>("kioskDevices");
  const device = await devices.findOne({
    _id: new ObjectId(session.deviceId),
    pinHash: session.pinHash,
    active: true,
  });
  if (!device) return null;
  const outlet = await db
    .collection<OutletSettingsDocument>("outlets")
    .findOne({ _id: device.outletId, active: true }, { projection: { _id: 1 } });
  if (!outlet) return null;
  await devices.updateOne(
    { _id: device._id, active: true },
    { $set: { lastUsedAt: new Date() } },
  );
  return device;
}
