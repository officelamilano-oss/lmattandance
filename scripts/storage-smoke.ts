import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEmployeeDocumentPath } from "../src/lib/employee-document-path";
import { getStorageAdapter } from "../src/lib/storage";
import { getConfiguredStorageProvider } from "../src/lib/storage/config";
import { verifySignedLocalStorageUrl } from "../src/lib/storage/signed-local-url";

async function main() {
  const provider = getConfiguredStorageProvider();
  const localDirectory =
    provider === "local"
      ? await mkdtemp(path.join(tmpdir(), "employee-storage-smoke-"))
      : undefined;
  if (localDirectory) process.env.STORAGE_LOCAL_DIRECTORY = localDirectory;
  let fileId: string | undefined;
  const filePath = buildEmployeeDocumentPath({
    outletName: "Storage Smoke Test",
    employeeName: "Temporary Employee",
    employeeCode: randomUUID(),
    fileName: `${randomUUID()}.pdf`,
  });
  const bytes = new TextEncoder().encode("%PDF-1.4\nstorage-smoke\n%%EOF");

  try {
    const storage = await getStorageAdapter();
    const stored = await storage.upload(bytes, filePath, {
      fileName: filePath.split("/").pop() ?? "storage-smoke.pdf",
      mimeType: "application/pdf",
    });
    fileId = stored.fileId;
    fileId = stored.fileId;
    assert.ok(stored.url, "upload should return a signed URL");
    if (stored.provider === "local") {
      const signed = new URL(stored.url, "http://localhost");
      assert.equal(
        verifySignedLocalStorageUrl(
          "local",
          signed.searchParams.get("path") ?? "",
          Number(signed.searchParams.get("expires")),
          signed.searchParams.get("signature") ?? "",
          process.env.AUTH_SECRET ?? "",
        ),
        true,
        "local signed URL should be valid",
      );
    } else {
      const response = await fetch(stored.url);
      assert.equal(response.ok, true, "signed URL should be readable");
      assert.deepEqual(
        new Uint8Array(await response.arrayBuffer()),
        bytes,
        "signed URL should return the uploaded bytes",
      );
    }

    assert.deepEqual(await storage.download(stored.fileId), bytes);
    await storage.delete(stored.fileId);
    fileId = undefined;
    await assert.rejects(() => storage.download(stored.fileId));
    console.log(`Upload, signed URL, download, and delete verified for ${stored.provider}.`);
  } finally {
    if (fileId) await (await getStorageAdapter()).delete(fileId);
    if (localDirectory) await rm(localDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("Storage smoke test failed.", error);
  process.exitCode = 1;
});
