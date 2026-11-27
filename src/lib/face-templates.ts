import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

export const FACE_DESCRIPTOR_LENGTH = 128;
export const FACE_CONSENT_VERSION = "v1";
export const FACE_MATCH_THRESHOLD = 0.5;

export interface EncryptedFaceDescriptor {
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function isFaceDescriptor(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === FACE_DESCRIPTOR_LENGTH &&
    value.every(
      (item) =>
        typeof item === "number" &&
        Number.isFinite(item) &&
        item >= -1 &&
        item <= 1,
    )
  );
}

export function getFaceEncryptionKey() {
  const configured = process.env.KIOSK_ENCRYPTION_KEY;
  if (!configured)
    throw new Error("KIOSK_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32)
    throw new Error("KIOSK_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptFaceDescriptor(
  descriptor: number[],
): EncryptedFaceDescriptor {
  if (!isFaceDescriptor(descriptor))
    throw new Error("Invalid face descriptor.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getFaceEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(descriptor), "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptFaceDescriptor(
  encrypted: EncryptedFaceDescriptor,
): number[] {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getFaceEncryptionKey(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const descriptor: unknown = JSON.parse(plaintext);
  if (!isFaceDescriptor(descriptor))
    throw new Error("Stored face descriptor is invalid.");
  return descriptor;
}

export function compareFaceDescriptors(
  first: number[],
  second: number[],
): number {
  if (!isFaceDescriptor(first) || !isFaceDescriptor(second))
    throw new Error("Invalid face descriptor.");
  let squaredDistance = 0;
  for (let index = 0; index < FACE_DESCRIPTOR_LENGTH; index += 1) {
    const difference = first[index] - second[index];
    squaredDistance += difference * difference;
  }
  return Math.sqrt(squaredDistance);
}
