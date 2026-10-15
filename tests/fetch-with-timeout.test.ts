import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithTimeout, type FetchLike } from "../src/fetch-with-timeout.js";
import type { FetchLike as SearchProviderFetchLike } from "../src/search-provider.js";

test("fetchWithTimeout forwards an abortable request and returns the response", async () => {
  let receivedSignal: AbortSignal | null | undefined;
  const fetchFn: FetchLike & SearchProviderFetchLike = async (_input, init) => {
    receivedSignal = init?.signal;
    return new Response("ok", { status: 200 });
  };

  const response = await fetchWithTimeout(fetchFn, "https://example.test", { method: "GET" }, 100);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(receivedSignal.aborted, false);
});

test("fetchWithTimeout reports a timeout when the request aborts", async () => {
  const fetchFn: FetchLike & SearchProviderFetchLike = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  await assert.rejects(
    () => fetchWithTimeout(fetchFn, "https://example.test", {}, 10),
    /Request timed out after 10ms: https:\/\/example\.test/,
  );
});
