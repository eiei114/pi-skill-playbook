import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RUNS_DIR } from "./state.js";

export const GITIGNORE_SNIPPET = `${RUNS_DIR}/`;

const IGNORE_PATTERNS = new Set([
  RUNS_DIR,
  `${RUNS_DIR}/`,
  `/${RUNS_DIR}`,
  `/${RUNS_DIR}/`,
  `${RUNS_DIR}/**`,
  ".pi",
  ".pi/",
  "/.pi",
  "/.pi/",
  ".pi/**",
  "/.pi/**",
]);

export function isPlaybookRunsGitignored(gitignoreContent: string): boolean {
  for (const raw of gitignoreContent.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    if (IGNORE_PATTERNS.has(line)) return true;
  }
  return false;
}

export async function getGitignoreAdvisory(cwd: string): Promise<string | undefined> {
  try {
    const gitignore = await readFile(join(cwd, ".gitignore"), "utf8");
    if (isPlaybookRunsGitignored(gitignore)) return undefined;
  } catch {
    // Missing .gitignore still needs advisory.
  }
  return `Run state is personal. Add this to .gitignore:\n${GITIGNORE_SNIPPET}`;
}
