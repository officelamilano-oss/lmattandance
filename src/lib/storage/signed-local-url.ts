import { createHmac, timingSafeEqual } from "node:crypto";
import type { StorageProviderName } from "@/lib/storage/types";

export function createSignedLocalStorageUrl(
  provider: StorageProviderName,
  filePath: string,
  expirySeconds: number,
  secret: string,
) {
  const expires = Math.floor(Date.now() / 1000) + expirySeconds;
  const signature = sign(provider, filePath, expires, secret);
  const query = new URLSearchParams({
    provider,
    path: filePath,
    expires: String(expires),
    signature,
  });
  return `/api/employee-documents/access?${query.toString()}`;
}

export function verifySignedLocalStorageUrl(
  provider: StorageProviderName,
  filePath: string,
  expires: number,
  signature: string,
  secret: string,
) {
  if (!Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000))
    return false;
  const expected = Buffer.from(sign(provider, filePath, expires, secret), "hex");
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(
  provider: StorageProviderName,
  filePath: string,
  expires: number,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`${provider}\n${filePath}\n${expires}`)
    .digest("hex");
}
