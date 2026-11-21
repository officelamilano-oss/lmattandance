import { constants } from "node:fs";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSignedLocalStorageUrl } from "@/lib/storage/signed-local-url";
import { getStorageSignedUrlExpirySeconds } from "@/lib/storage/config";
import type {
  MovedFile,
  StorageAdapter,
  StoredFile,
} from "@/lib/storage/types";

// Local private files stay outside Next.js's public directory.
export class LocalStorageAdapter implements StorageAdapter {
  readonly provider = "local" as const;
  private readonly rootDirectory: string;
  private readonly signingSecret: string;

  constructor(options: { rootDirectory?: string; signingSecret?: string } = {}) {
    this.rootDirectory = path.resolve(
      /*turbopackIgnore: true*/
      options.rootDirectory ??
        process.env.STORAGE_LOCAL_DIRECTORY ??
        path.join(process.cwd(), ".storage", "employee-documents"),
    );
    this.signingSecret = options.signingSecret ?? process.env.AUTH_SECRET ?? "";
    if (!this.signingSecret)
      throw new Error("AUTH_SECRET is required to sign local private-file links.");
  }

  async upload(
    file: Uint8Array,
    filePath: string,
  ): Promise<StoredFile> {
    const target = this.resolvePath(filePath);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, Buffer.from(file), { flag: "wx", mode: 0o600 });
    return {
      fileId: filePath,
      filePath,
      url: await this.getSignedUrl(
        filePath,
        getStorageSignedUrlExpirySeconds(),
      ),
      provider: this.provider,
    };
  }

  async delete(fileId: string) {
    await unlink(this.resolvePath(fileId));
  }

  async getSignedUrl(fileIdOrFilePath: string, expirySeconds: number) {
    return createSignedLocalStorageUrl(
      this.provider,
      fileIdOrFilePath,
      expirySeconds,
      this.signingSecret,
    );
  }

  async move(fileId: string, newPath: string): Promise<MovedFile> {
    const source = this.resolvePath(fileId);
    const destination = this.resolvePath(newPath);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await unlink(source);
    return { fileId: newPath, filePath: newPath };
  }

  async download(fileIdOrFilePath: string) {
    return new Uint8Array(await readFile(this.resolvePath(fileIdOrFilePath)));
  }

  private resolvePath(filePath: string) {
    if (
      !filePath.startsWith("/employees/") ||
      filePath.includes("\\") ||
      filePath.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error("Invalid employee document path.");
    const target = path.resolve(this.rootDirectory, filePath.slice(1));
    const relative = path.relative(this.rootDirectory, target);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Invalid employee document path.");
    return target;
  }
}
