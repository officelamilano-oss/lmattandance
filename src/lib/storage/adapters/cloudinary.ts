import { v2 as cloudinary } from "cloudinary";
import path from "node:path";
import { getStorageSignedUrlExpirySeconds } from "@/lib/storage/config";
import type {
  MovedFile,
  StorageAdapter,
  StorageUploadOptions,
  StoredFile,
} from "@/lib/storage/types";

type CloudinaryResourceType = "image" | "raw";

export interface CloudinaryStorageConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

// Authenticated assets require a signed, expiring download URL.
export class CloudinaryStorageAdapter implements StorageAdapter {
  readonly provider = "cloudinary" as const;

  constructor(config: CloudinaryStorageConfig) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
      urlAnalytics: false,
    });
  }

  async upload(
    file: Uint8Array,
    filePath: string,
    options: StorageUploadOptions,
  ): Promise<StoredFile> {
    const asset = assetFromPath(filePath);
    if (mimeTypeForFormat[asset.format] !== options.mimeType)
      throw new Error("The document extension does not match its file type.");
    const result = await new Promise<{
      public_id: string;
    }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: asset.publicId,
          resource_type: asset.resourceType,
          type: "authenticated",
          overwrite: false,
          unique_filename: false,
          use_filename: false,
          context: `fileType=${options.mimeType}`,
        },
        (error, response) => {
          if (error) {
            reject(error);
            return;
          }
          if (!response?.public_id) {
            reject(new Error("Cloudinary did not return an asset public ID."));
            return;
          }
          resolve(response);
        },
      );
      stream.end(Buffer.from(file));
    });

    return {
      fileId: serializeAssetId(asset.resourceType, asset.format, result.public_id),
      filePath,
      url: await this.getSignedUrl(
        filePath,
        getStorageSignedUrlExpirySeconds(),
      ),
      provider: this.provider,
    };
  }

  async delete(fileId: string) {
    const asset = assetFromIdentifier(fileId);
    const result = await cloudinary.uploader.destroy(asset.publicId, {
      resource_type: asset.resourceType,
      type: "authenticated",
      invalidate: true,
    });
    if (result.result !== "ok" && result.result !== "not found")
      throw new Error(`Cloudinary could not delete the asset (${result.result}).`);
  }

  async getSignedUrl(fileIdOrFilePath: string, expirySeconds: number) {
    const asset = assetFromIdentifier(fileIdOrFilePath);
    return cloudinary.utils.private_download_url(
      asset.publicId,
      asset.format,
      {
        resource_type: asset.resourceType,
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + expirySeconds,
      },
    );
  }

  async move(fileId: string, newPath: string): Promise<MovedFile> {
    const current = assetFromIdentifier(fileId);
    const destination = assetFromPath(newPath);
    if (
      current.resourceType !== destination.resourceType ||
      current.format !== destination.format
    )
      throw new Error("Cloudinary cannot change document type while moving it.");
    const result = await cloudinary.uploader.rename(
      current.publicId,
      destination.publicId,
      {
        resource_type: current.resourceType,
        type: "authenticated",
        overwrite: false,
        invalidate: true,
      },
    );
    if (!result?.public_id)
      throw new Error("Cloudinary did not return the moved asset public ID.");
    return {
      fileId: serializeAssetId(
        current.resourceType,
        destination.format,
        result.public_id,
      ),
      filePath: newPath,
    };
  }

  async download(fileIdOrFilePath: string) {
    const url = await this.getSignedUrl(
      fileIdOrFilePath,
      getStorageSignedUrlExpirySeconds(),
    );
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Cloudinary download failed with status ${response.status}.`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

function assetFromIdentifier(value: string) {
  const identifier = /^(image|raw):([a-z0-9]+):(.+)$/i.exec(value);
  if (identifier) {
    const resourceType = identifier[1].toLowerCase() as CloudinaryResourceType;
    const format = identifier[2].toLowerCase();
    const publicId = identifier[3];
    if (
      !mimeTypeForFormat[format] ||
      (resourceType === "raw") !== (format === "pdf")
    )
      throw new Error("Invalid Cloudinary employee document type.");
    assertPublicId(publicId);
    return { resourceType, format, publicId };
  }
  return assetFromPath(value);
}

function assetFromPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (
    !normalizedPath.startsWith("/employees/") &&
    !normalizedPath.startsWith("employees/")
  )
    throw new Error("Invalid employee document path.");
  if (normalizedPath.split("/").some((part) => part === "." || part === ".."))
    throw new Error("Invalid employee document path.");

  const publicId = normalizedPath.replace(/^\/+/, "");
  const extension = path.posix.extname(publicId).slice(1).toLowerCase();
  if (!mimeTypeForFormat[extension])
    throw new Error("Unsupported Cloudinary employee document format.");
  const resourceType: CloudinaryResourceType =
    extension === "pdf" ? "raw" : "image";
  const imagePublicId =
    resourceType === "image"
      ? publicId.slice(0, -path.posix.extname(publicId).length)
      : publicId;
  assertPublicId(imagePublicId);
  return { resourceType, format: extension, publicId: imagePublicId };
}

const mimeTypeForFormat: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

function serializeAssetId(
  resourceType: CloudinaryResourceType,
  format: string,
  publicId: string,
) {
  return `${resourceType}:${format}:${publicId}`;
}

function assertPublicId(publicId: string) {
  if (
    !publicId.startsWith("employees/") ||
    publicId.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid Cloudinary employee document ID.");
}
