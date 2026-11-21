import ImageKit, { toFile } from "@imagekit/nodejs";
import path from "node:path";
import { getStorageSignedUrlExpirySeconds } from "@/lib/storage/config";
import type {
  MovedFile,
  StorageAdapter,
  StorageUploadOptions,
  StoredFile,
} from "@/lib/storage/types";

export interface ImageKitStorageConfig {
  publicKey: string;
  privateKey: string;
  urlEndpoint: string;
}

// ImageKit files remain private and are exposed only through expiring signed URLs.
export class ImageKitStorageAdapter implements StorageAdapter {
  readonly provider = "imagekit" as const;
  private readonly client: ImageKit;

  constructor(private readonly config: ImageKitStorageConfig) {
    this.client = new ImageKit({ privateKey: config.privateKey });
  }

  async upload(
    file: Uint8Array,
    filePath: string,
    options: StorageUploadOptions,
  ): Promise<StoredFile> {
    const fileName = path.posix.basename(filePath);
    const folder = path.posix.dirname(filePath);
    const result = await this.client.files.upload({
      file: await toFile(Buffer.from(file), fileName, { type: options.mimeType }),
      fileName,
      folder,
      isPrivateFile: true,
      overwriteFile: false,
      useUniqueFileName: false,
    });
    if (!result.fileId || !result.filePath)
      throw new Error("ImageKit did not return the uploaded file identifier and path.");
    return {
      fileId: result.fileId,
      filePath: result.filePath,
      url: await this.getSignedUrl(result.filePath, getStorageSignedUrlExpirySeconds()),
      provider: this.provider,
    };
  }

  async delete(fileId: string) {
    await this.client.files.delete(fileId);
  }

  async getSignedUrl(fileIdOrFilePath: string, expirySeconds: number) {
    return this.client.helper.buildSrc({
      urlEndpoint: this.config.urlEndpoint,
      src: fileIdOrFilePath,
      signed: true,
      expiresIn: expirySeconds,
    });
  }

  async move(fileId: string, newPath: string): Promise<MovedFile> {
    const current = await this.client.files.get(fileId);
    if (!current.filePath)
      throw new Error("ImageKit did not return the current employee document path.");
    await this.client.files.move({
      sourceFilePath: current.filePath,
      destinationPath: path.posix.dirname(newPath),
    });
    return { fileId, filePath: newPath };
  }

  async download(fileIdOrFilePath: string) {
    const url = await this.getSignedUrl(
      fileIdOrFilePath,
      getStorageSignedUrlExpirySeconds(),
    );
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`ImageKit download failed with status ${response.status}.`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
