import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RUNS_DIR } from "./state.js";

export async function getGitignoreAdvisory(cwd: string): Promise<string | undefined> {
  try {
    const gitignore = await readFile(join(cwd, ".gitignore"), "utf8");
    const lines = gitignore.split(/\r?\n/).map((line) => line.trim());
    if (lines.includes(RUNS_DIR) || lines.includes(`${RUNS_DIR}/`)) return undefined;
  } catch {
    // Missing .gitignore still needs advisory.
  }
  return `Run state is personal. Add this to .gitignore:\n${RUNS_DIR}/`;
}
