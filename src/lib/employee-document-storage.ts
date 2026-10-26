import { randomUUID } from "node:crypto";
import { GridFSBucket } from "mongodb";
import { getDb } from "@/lib/mongodb";

export interface StoredEmployeeFile {
  key: string;
  mimeType: string;
  size: number;
}

export interface EmployeeDocumentStorage {
  uploadFile(
    bytes: Uint8Array,
    meta: { mimeType: string; extension: string },
  ): Promise<StoredEmployeeFile>;
  readFile(key: string): Promise<Buffer>;
  getFileUrl(documentId: string): string;
  deleteFile(key: string): Promise<void>;
}

const bucketName = "employeePrivateDocuments";

async function getBucket() {
  const provider =
    process.env.EMPLOYEE_DOCUMENT_STORAGE_PROVIDER?.trim().toLowerCase() ??
    "mongodb";
  if (provider !== "mongodb")
    throw new Error(
      `Employee document storage provider "${provider}" is not configured. Set EMPLOYEE_DOCUMENT_STORAGE_PROVIDER=mongodb.`,
    );
  return new GridFSBucket(await getDb(), { bucketName });
}

function assertStorageKey(key: string) {
  if (!/^[a-f\d-]{36}\.(jpg|jpeg|png|webp|pdf)$/i.test(key))
    throw new Error("Invalid employee document key.");
}

export const employeeDocumentStorage: EmployeeDocumentStorage = {
  async uploadFile(bytes, meta) {
    const bucket = await getBucket();
    const key = `${randomUUID()}${meta.extension}`;
    const upload = bucket.openUploadStream(key, {
      metadata: { mimeType: meta.mimeType },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        upload.once("finish", resolve);
        upload.once("error", reject);
        upload.end(Buffer.from(bytes));
      });
    } catch (error) {
      try {
        await bucket.delete(upload.id);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Employee document upload failed and GridFS cleanup was incomplete.",
        );
      }
      throw error;
    }
    return { key, mimeType: meta.mimeType, size: bytes.byteLength };
  },
  async readFile(key) {
    assertStorageKey(key);
    const bucket = await getBucket();
    const chunks: Buffer[] = [];
    for await (const chunk of bucket.openDownloadStreamByName(key))
      chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  },
  getFileUrl(documentId) {
    return `/api/employee-documents/${encodeURIComponent(documentId)}`;
  },
  async deleteFile(key) {
    assertStorageKey(key);
    const bucket = await getBucket();
    const matches = await bucket.find({ filename: key }).toArray();
    await Promise.all(matches.map((file) => bucket.delete(file._id)));
  },
};
