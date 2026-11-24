import type {
  ConfiguredStorageProviderName,
  StorageProviderName,
} from "@/lib/storage/types";

const configuredProviders = ["imagekit", "cloudinary", "s3", "local"] as const;

export function getConfiguredStorageProvider(): ConfiguredStorageProviderName {
  const provider = process.env.STORAGE_PROVIDER?.trim().toLowerCase() || "imagekit";
  if (!configuredProviders.includes(provider as ConfiguredStorageProviderName))
    throw new Error(
      `Unsupported STORAGE_PROVIDER "${provider}". Choose imagekit, cloudinary, s3, or local.`,
    );
  return provider as ConfiguredStorageProviderName;
}

export function validateStorageConfiguration(
  provider: StorageProviderName = getConfiguredStorageProvider(),
) {
  const missing: string[] = [];
  if (provider === "imagekit") {
    for (const key of [
      "IMAGEKIT_PUBLIC_KEY",
      "IMAGEKIT_PRIVATE_KEY",
      "IMAGEKIT_URL_ENDPOINT",
    ])
      if (!process.env[key]?.trim()) missing.push(key);
  } else if (provider === "cloudinary") {
    for (const key of [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
    ])
      if (!process.env[key]?.trim()) missing.push(key);
  } else if (provider === "s3") {
    for (const key of [
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
    ])
      if (!process.env[key]?.trim()) missing.push(key);
  } else if (provider === "local" && !process.env.AUTH_SECRET?.trim()) {
    missing.push("AUTH_SECRET");
  } else if (provider === "mongodb" && !process.env.MONGODB_URI?.trim()) {
    missing.push("MONGODB_URI");
  }

  if (missing.length)
    throw new Error(
      `Storage provider "${provider}" is missing required environment variables: ${missing.join(", ")}. Set them in the server environment before starting the application.`,
    );
  getStorageSignedUrlExpirySeconds();
  getStorageMaxFileSizeBytes();
}

export function getStorageSignedUrlExpirySeconds() {
  const raw = process.env.STORAGE_SIGNED_URL_EXPIRY?.trim();
  if (!raw) return 600;
  const expiry = Number(raw);
  if (!Number.isInteger(expiry) || expiry < 1 || expiry > 3600)
    throw new Error("STORAGE_SIGNED_URL_EXPIRY must be an integer from 1 to 3600.");
  return expiry;
}

export function getStorageMaxFileSizeBytes() {
  const raw = process.env.MAX_FILE_SIZE_MB?.trim();
  if (!raw) return 3 * 1024 * 1024;
  const sizeMb = Number(raw);
  if (!Number.isInteger(sizeMb) || sizeMb < 1 || sizeMb > 3)
    throw new Error("MAX_FILE_SIZE_MB must be an integer from 1 to 3.");
  return sizeMb * 1024 * 1024;
}
