export type StorageProviderName =
  | "imagekit"
  | "cloudinary"
  | "s3"
  | "local"
  | "mongodb";
export type ConfiguredStorageProviderName = Exclude<
  StorageProviderName,
  "mongodb"
>;

export interface StorageUploadOptions {
  fileName: string;
  mimeType: string;
}

export interface StoredFile {
  fileId: string;
  filePath: string;
  url: string;
  provider: StorageProviderName;
}

export interface MovedFile {
  fileId: string;
  filePath: string;
}

export interface StorageAdapter {
  readonly provider: StorageProviderName;
  upload(
    file: Uint8Array,
    filePath: string,
    options: StorageUploadOptions,
  ): Promise<StoredFile>;
  delete(fileId: string): Promise<void>;
  getSignedUrl(fileIdOrFilePath: string, expirySeconds: number): Promise<string>;
  move(fileId: string, newPath: string): Promise<MovedFile>;
  download(fileIdOrFilePath: string): Promise<Uint8Array>;
}

export class StorageMoveUnsupportedError extends Error {
  constructor(provider: StorageProviderName) {
    super(`The ${provider} storage adapter does not support moving files.`);
    this.name = "StorageMoveUnsupportedError";
  }
}
