import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RECORDS_DIR } from "./record-state.js";
import { RUNS_DIR } from "./state.js";

export const GITIGNORE_SNIPPET = `${RUNS_DIR}/\n${RECORDS_DIR}/`;

const PI_IGNORE_PATTERNS = new Set([
  ".pi",
  ".pi/",
  "/.pi",
  "/.pi/",
  ".pi/**",
  "/.pi/**",
]);

function ignorePatternsFor(dir: string): Set<string> {
  return new Set([
    dir,
    `${dir}/`,
    `/${dir}`,
    `/${dir}/`,
    `${dir}/**`,
    ...PI_IGNORE_PATTERNS,
  ]);
}

function isDirGitignored(gitignoreContent: string, dir: string): boolean {
  const patterns = ignorePatternsFor(dir);
  let ignored = false;
  for (const raw of gitignoreContent.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const negated = line.startsWith("!");
    const candidate = negated ? line.slice(1).trim() : line;
    if (!patterns.has(candidate)) continue;

    ignored = !negated;
  }
  return ignored;
}

export function isPlaybookRunsGitignored(gitignoreContent: string): boolean {
  return isDirGitignored(gitignoreContent, RUNS_DIR);
}

export function isPlaybookRecordsGitignored(gitignoreContent: string): boolean {
  return isDirGitignored(gitignoreContent, RECORDS_DIR);
}

function gitignoreSnippetFor(runsIgnored: boolean, recordsIgnored: boolean): string {
  const lines: string[] = [];
  if (!runsIgnored) lines.push(`${RUNS_DIR}/`);
  if (!recordsIgnored) lines.push(`${RECORDS_DIR}/`);
  return lines.join("\n");
}

export async function getGitignoreAdvisory(cwd: string): Promise<string | undefined> {
  let gitignore = "";
  try {
    gitignore = await readFile(join(cwd, ".gitignore"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    // Missing .gitignore still needs advisory.
  }

  const runsIgnored = isPlaybookRunsGitignored(gitignore);
  const recordsIgnored = isPlaybookRecordsGitignored(gitignore);
  if (runsIgnored && recordsIgnored) return undefined;

  const snippet = gitignoreSnippetFor(runsIgnored, recordsIgnored);
  return `Run state is personal. Add this to .gitignore:\n${snippet}`;
}
