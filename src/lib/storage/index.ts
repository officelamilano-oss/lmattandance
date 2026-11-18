import "server-only";
import { getConfiguredStorageProvider, validateStorageConfiguration } from "@/lib/storage/config";
import type {
  ConfiguredStorageProviderName,
  StorageAdapter,
  StorageProviderName,
} from "@/lib/storage/types";

const adapters = new Map<StorageProviderName, StorageAdapter>();

export async function getStorageAdapter(
  provider: StorageProviderName = getConfiguredStorageProvider(),
): Promise<StorageAdapter> {
  validateStorageConfiguration(provider);
  const cached = adapters.get(provider);
  if (cached) return cached;

  let adapter: StorageAdapter;
  switch (provider) {
    case "imagekit": {
      const { ImageKitStorageAdapter } = await import(
        "@/lib/storage/adapters/imagekit"
      );
      adapter = new ImageKitStorageAdapter({
        publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
        privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
        urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!,
      });
      break;
    }
    case "cloudinary": {
      const { CloudinaryStorageAdapter } = await import(
        "@/lib/storage/adapters/cloudinary"
      );
      adapter = new CloudinaryStorageAdapter({
        cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
        apiKey: process.env.CLOUDINARY_API_KEY!,
        apiSecret: process.env.CLOUDINARY_API_SECRET!,
      });
      break;
    }
    case "s3": {
      const { S3StorageAdapter } = await import("@/lib/storage/adapters/s3");
      adapter = new S3StorageAdapter({
        endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
        region: process.env.S3_REGION!,
        bucket: process.env.S3_BUCKET!,
        accessKey: process.env.S3_ACCESS_KEY!,
        secretKey: process.env.S3_SECRET_KEY!,
      });
      break;
    }
    case "local": {
      const { LocalStorageAdapter } = await import(
        "@/lib/storage/adapters/local"
      );
      adapter = new LocalStorageAdapter();
      break;
    }
    case "mongodb": {
      const { MongoGridFsStorageAdapter } = await import(
        "@/lib/storage/adapters/mongodb"
      );
      adapter = new MongoGridFsStorageAdapter();
      break;
    }
  }
  adapters.set(provider, adapter);
  return adapter;
}

export function getEmployeeFileProvider(
  document: { provider?: string },
): StorageProviderName {
  const provider = document.provider ?? "mongodb";
  if (
    provider !== "imagekit" &&
    provider !== "cloudinary" &&
    provider !== "s3" &&
    provider !== "local" &&
    provider !== "mongodb"
  )
    throw new Error(`Unsupported employee document provider "${provider}".`);
  return provider;
}

export function getEmployeeFileId(document: {
  fileId?: string;
  storageKey?: string;
}) {
  const fileId = document.fileId ?? document.storageKey;
  if (!fileId) throw new Error("Employee document has no storage identifier.");
  return fileId;
}

export function getEmployeeFilePath(document: {
  filePath?: string;
  storageKey?: string;
}) {
  const filePath = document.filePath ?? document.storageKey;
  if (!filePath) throw new Error("Employee document has no storage path.");
  return filePath;
}

export function getStorageProviderName(): ConfiguredStorageProviderName {
  return getConfiguredStorageProvider();
}

export { StorageMoveUnsupportedError } from "@/lib/storage/types";
export type {
  StorageAdapter,
  StorageProviderName,
  StoredFile,
} from "@/lib/storage/types";
