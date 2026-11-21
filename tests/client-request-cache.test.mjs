import assert from "node:assert/strict";
import test from "node:test";
import { ClientRequestCache } from "../src/lib/client-request-cache.ts";

test("deduplicates concurrent requests and reuses fresh data", async () => {
  const cache = new ClientRequestCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return { value: calls };
  };

  const [first, concurrent] = await Promise.all([
    cache.get("user@example.com", "/api/outlets", 60_000, load),
    cache.get("user@example.com", "/api/outlets", 60_000, load),
  ]);
  const cached = await cache.get("user@example.com", "/api/outlets", 60_000, load);

  assert.equal(first, concurrent);
  assert.equal(cached, first);
  assert.equal(calls, 1);
});

test("does not cache failed requests and invalidates matching URLs", async () => {
  const cache = new ClientRequestCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary failure");
    return calls;
  };

  await assert.rejects(cache.get("user@example.com", "/api/outlets", 60_000, load));
  assert.equal(await cache.get("user@example.com", "/api/outlets", 60_000, load), 2);
  cache.invalidateUrl("/api/outlets");
  assert.equal(await cache.get("user@example.com", "/api/outlets", 60_000, load), 3);
});

test("keeps cached values isolated by user scope", async () => {
  const cache = new ClientRequestCache();
  let calls = 0;
  const load = async () => ++calls;

  assert.equal(await cache.get("first@example.com", "/api/outlets", 60_000, load), 1);
  assert.equal(await cache.get("second@example.com", "/api/outlets", 60_000, load), 2);
});
