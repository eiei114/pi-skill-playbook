import assert from "node:assert/strict";

// Offline API fixture for real version-check CLI tests; never production-loaded.
globalThis.fetch = async (url, options) => {
  assert.equal(url, "https://api.github.com/repos/example/project/pulls/42");
  assert.equal(options.headers.Authorization, "Bearer fixture-token");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal);
  const scenario = process.env.PR_FETCH_FIXTURE;
  if (scenario === "offline") throw new Error("offline fixture");
  if (scenario === "denied") return new Response("denied", { status: 403 });
  if (scenario === "invalid") return new Response("not json");
  if (scenario === "oversize") return new Response("x".repeat(300_000));
  return new Response(JSON.stringify({ body: scenario === "no-release" ? "Release: none" : "ordinary PR" }));
};
