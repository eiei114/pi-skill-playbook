#!/usr/bin/env node
/**
 * Ensure GitHub Actions workflow dependencies are pinned to immutable SHAs.
 *
 * Allowed refs:
 * - local reusable actions/workflows: ./path
 * - Docker actions: docker://image[:tag]
 * - remote actions: owner/repo[/path]@<40-hex-sha>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowDir = ".github/workflows";
const shaRef = /@[0-9a-f]{40}(?:\s*(?:#.*)?)?$/i;
const usesLine = /^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/;
const failures = [];

for (const file of readdirSync(workflowDir).sort()) {
  if (!/\.ya?ml$/i.test(file)) continue;
  const path = join(workflowDir, file);
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = usesLine.exec(line);
    if (!match) return;
    const spec = match[1];
    if (spec.startsWith("./") || spec.startsWith("docker://")) return;
    if (!shaRef.test(spec)) {
      failures.push(`${path}:${index + 1}: ${spec}`);
    }
  });
}

if (failures.length > 0) {
  console.error("actions:check fail - pin remote workflow actions to 40-character commit SHAs:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("actions:check ok - all remote workflow actions are SHA-pinned");
