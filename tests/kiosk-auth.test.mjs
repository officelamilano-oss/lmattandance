import test from "node:test";
import assert from "node:assert/strict";
import {
  createKioskPin,
  createKioskSessionToken,
  decryptKioskPin,
  encryptKioskPin,
  getKioskSessionClaims,
  hashKioskPin,
  KIOSK_SESSION_MAX_AGE_SECONDS,
} from "../src/lib/kiosk-auth.ts";

const originalAuthSecret = process.env.AUTH_SECRET;
const originalKioskEncryptionKey = process.env.KIOSK_ENCRYPTION_KEY;
process.env.AUTH_SECRET = "test-kiosk-auth-secret-with-sufficient-entropy";
process.env.KIOSK_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString("base64");

test("kiosk PINs are eight digits and their stored values are keyed hashes", () => {
  const pin = createKioskPin();
  assert.match(pin, /^\d{8}$/);
  assert.match(hashKioskPin(pin), /^[a-f\d]{64}$/);
  assert.notEqual(hashKioskPin(pin), pin);
  assert.notEqual(hashKioskPin(pin), hashKioskPin("00000000"));
});

test("kiosk sessions are signed, expire, and carry the PIN version for revocation", () => {
  const deviceId = "0123456789abcdef01234567";
  const pinHash = hashKioskPin("12345678");
  const token = createKioskSessionToken(deviceId, pinHash);
  assert.deepEqual(getKioskSessionClaims(token), { deviceId, pinHash });
  assert.equal(getKioskSessionClaims(`${token}x`), null);

  const expired = createKioskSessionToken(
    deviceId,
    pinHash,
    Math.floor(Date.now() / 1000) - 1,
  );
  assert.equal(getKioskSessionClaims(expired), null);
  assert.equal(KIOSK_SESSION_MAX_AGE_SECONDS, 60 * 60 * 24 * 365);
});

test("saved kiosk PINs are encrypted at rest and decrypt to the generated value", () => {
  const pin = createKioskPin();
  const encrypted = encryptKioskPin(pin);
  assert.notEqual(encrypted.ciphertext, Buffer.from(pin).toString("base64"));
  assert.equal(decryptKioskPin(encrypted), pin);
});

test.after(() => {
  if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalAuthSecret;
  if (originalKioskEncryptionKey === undefined)
    delete process.env.KIOSK_ENCRYPTION_KEY;
  else process.env.KIOSK_ENCRYPTION_KEY = originalKioskEncryptionKey;
});
