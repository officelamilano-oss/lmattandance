import test from "node:test";
import assert from "node:assert/strict";
import { CloudinaryStorageAdapter } from "../src/lib/storage/adapters/cloudinary.ts";

const storage = new CloudinaryStorageAdapter({
  cloudName: "test-cloud",
  apiKey: "test-key",
  apiSecret: "test-secret",
});

test("Cloudinary PDF signed links use authenticated, expiring raw delivery", async () => {
  const before = Math.floor(Date.now() / 1000);
  const signedUrl = await storage.getSignedUrl(
    "/employees/outlet/employee-001/id-card.pdf",
    120,
  );
  const url = new URL(signedUrl);
  const expiresAt = Number(url.searchParams.get("expires_at"));

  assert.match(url.pathname, /\/raw\/download$/);
  assert.equal(url.searchParams.get("type"), "authenticated");
  assert.equal(url.searchParams.get("format"), "pdf");
  assert.equal(url.searchParams.get("public_id"), "employees/outlet/employee-001/id-card.pdf");
  assert.ok(expiresAt > before && expiresAt <= before + 120);
});

test("Cloudinary image signed links use authenticated image delivery", async () => {
  const url = new URL(
    await storage.getSignedUrl(
      "/employees/outlet/employee-001/profile.jpg",
      120,
    ),
  );

  assert.match(url.pathname, /\/image\/download$/);
  assert.equal(url.searchParams.get("type"), "authenticated");
  assert.equal(url.searchParams.get("format"), "jpg");
  assert.equal(url.searchParams.get("public_id"), "employees/outlet/employee-001/profile");
});

test("Cloudinary rejects paths outside employee documents", async () => {
  await assert.rejects(
    () => storage.getSignedUrl("/employees/../outside/file.pdf", 120),
    /Invalid employee document path/,
  );
});
