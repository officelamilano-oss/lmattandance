import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as signS3Url } from "@aws-sdk/s3-request-presigner";
import { getStorageSignedUrlExpirySeconds } from "@/lib/storage/config";
import type {
  MovedFile,
  StorageAdapter,
  StorageUploadOptions,
  StoredFile,
} from "@/lib/storage/types";

export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

// Objects have no public ACL; temporary signed GET URLs provide read access.
export class S3StorageAdapter implements StorageAdapter {
  readonly provider = "s3" as const;
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint || undefined,
      region: config.region,
      forcePathStyle: Boolean(config.endpoint),
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
  }

  async upload(
    file: Uint8Array,
    filePath: string,
    options: StorageUploadOptions,
  ): Promise<StoredFile> {
    const key = toObjectKey(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: Buffer.from(file),
        ContentLength: file.byteLength,
        ContentType: options.mimeType,
      }),
    );
    return {
      fileId: key,
      filePath: `/${key}`,
      url: await this.getSignedUrl(key, getStorageSignedUrlExpirySeconds()),
      provider: this.provider,
    };
  }

  async delete(fileId: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: toObjectKey(fileId),
      }),
    );
  }

  async getSignedUrl(fileIdOrFilePath: string, expirySeconds: number) {
    return signS3Url(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: toObjectKey(fileIdOrFilePath),
      }),
      { expiresIn: expirySeconds },
    );
  }

  async move(fileId: string, newPath: string): Promise<MovedFile> {
    const sourceKey = toObjectKey(fileId);
    const destinationKey = toObjectKey(newPath);
    if (sourceKey !== destinationKey) {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.config.bucket,
          Key: destinationKey,
          CopySource: `${encodeURIComponent(this.config.bucket)}/${sourceKey
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
        }),
      );
      await this.delete(sourceKey);
    }
    return { fileId: destinationKey, filePath: `/${destinationKey}` };
  }

  async download(fileIdOrFilePath: string) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: toObjectKey(fileIdOrFilePath),
      }),
    );
    if (!response.Body)
      throw new Error("The requested S3 employee document has no content.");
    return new Uint8Array(await response.Body.transformToByteArray());
  }
}

function toObjectKey(fileIdOrFilePath: string) {
  const key = fileIdOrFilePath.replace(/^\/+/, "");
  if (
    !key.startsWith("employees/") ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid employee document object key.");
  return key;
}
