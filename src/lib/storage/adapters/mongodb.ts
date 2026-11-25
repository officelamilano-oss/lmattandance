import { randomUUID } from "node:crypto";
import { GridFSBucket } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getStorageSignedUrlExpirySeconds } from "@/lib/storage/config";
import { createSignedLocalStorageUrl } from "@/lib/storage/signed-local-url";
import type {
  MovedFile,
  StorageAdapter,
  StorageUploadOptions,
  StoredFile,
} from "@/lib/storage/types";
import { StorageMoveUnsupportedError } from "@/lib/storage/types";

const bucketName = "employeePrivateDocuments";

// Keeps pre-provider GridFS uploads readable and deletable.
export class MongoGridFsStorageAdapter implements StorageAdapter {
  readonly provider = "mongodb" as const;

  async upload(
    file: Uint8Array,
    filePath: string,
    options: StorageUploadOptions,
  ): Promise<StoredFile> {
    const fileId = `${randomUUID()}${extensionFromMime(options.mimeType)}`;
    const bucket = new GridFSBucket(await getDb(), { bucketName });
    const upload = bucket.openUploadStream(fileId, {
      metadata: { mimeType: options.mimeType },
    });
    await new Promise<void>((resolve, reject) => {
      upload.once("finish", resolve);
      upload.once("error", reject);
      upload.end(Buffer.from(file));
    });
    return {
      fileId,
      filePath,
      url: await this.getSignedUrl(filePath, getStorageSignedUrlExpirySeconds()),
      provider: this.provider,
    };
  }

  async delete(fileId: string) {
    assertMongoFileId(fileId);
    const bucket = new GridFSBucket(await getDb(), { bucketName });
    const matches = await bucket.find({ filename: fileId }).toArray();
    await Promise.all(matches.map((file) => bucket.delete(file._id)));
  }

  async getSignedUrl(fileIdOrFilePath: string, expirySeconds: number) {
    return createSignedLocalStorageUrl(
      this.provider,
      fileIdOrFilePath,
      expirySeconds,
      requireSigningSecret(),
    );
  }

  async move(): Promise<MovedFile> {
    throw new StorageMoveUnsupportedError(this.provider);
  }

  async download(fileIdOrFilePath: string) {
    assertMongoFileId(fileIdOrFilePath);
    const bucket = new GridFSBucket(await getDb(), { bucketName });
    const chunks: Buffer[] = [];
    for await (const chunk of bucket.openDownloadStreamByName(fileIdOrFilePath))
      chunks.push(Buffer.from(chunk));
    return new Uint8Array(Buffer.concat(chunks));
  }
}

function assertMongoFileId(fileId: string) {
  if (!/^[a-f\d-]{36}\.(jpg|jpeg|png|webp|pdf)$/i.test(fileId))
    throw new Error("Invalid legacy employee document identifier.");
}

function extensionFromMime(mimeType: string) {
  return {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  }[mimeType] ?? ".bin";
}

function requireSigningSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is required to sign private-file links.");
  return secret;
}
