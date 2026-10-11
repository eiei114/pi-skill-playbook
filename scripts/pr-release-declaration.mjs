import { existsSync, readFileSync, statSync } from "node:fs";

const MAX_BYTES = 256 * 1024;
const declared = (body) => typeof body === "string" && /^Release: none$/im.test(body);

export async function hasNoReleaseDeclaration() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  try {
    if (eventPath && existsSync(eventPath)) {
      if (statSync(eventPath).size > MAX_BYTES) return false;
      const event = JSON.parse(readFileSync(eventPath, "utf8"));
      const body = event.pull_request?.body;
      // Empty/non-string bodies are not missing bodies. Do not override them.
      if (body !== undefined && body !== null) return declared(body);
    }
  } catch { return false; }

  const pullNumber = /^refs\/pull\/([1-9]\d*)\/merge$/.exec(process.env.GITHUB_REF ?? "")?.[1];
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const token = process.env.GITHUB_TOKEN;
  // This repository targets GitHub.com. No credential-bearing arbitrary API
  // origin, redirect or write request is authorized by a PR declaration.
  if (process.env.GITHUB_EVENT_NAME !== "pull_request" || !pullNumber || !token ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository) ||
      (process.env.GITHUB_API_URL && process.env.GITHUB_API_URL !== "https://api.github.com")) return false;
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${pullNumber}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
      redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); return false; }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) throw new Error("PR response over budget");
      chunks.push(chunk);
    }
    return declared(JSON.parse(Buffer.concat(chunks).toString("utf8")).body);
  } catch {
    // Unknown/denied/offline is not permission to skip version policy. Never
    // emit credentials or raw server errors into the CI log.
    return false;
  }
}
