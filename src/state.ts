import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isNotFound, readJsonIfExists } from "./fs-errors.js";
import type { ActiveRunState, PlaybookRunState } from "./types.js";

export const RUNS_DIR = ".pi/playbook-runs";
const ACTIVE_FILE = "active.json";

export function runsDir(cwd: string): string {
  return join(cwd, RUNS_DIR);
}

export function runFile(cwd: string, runId: string): string {
  return join(runsDir(cwd), `${runId}.json`);
}

export function activeFile(cwd: string): string {
  return join(runsDir(cwd), ACTIVE_FILE);
}

export async function saveRun(cwd: string, run: PlaybookRunState): Promise<void> {
  await mkdir(runsDir(cwd), { recursive: true });
  await writeFile(runFile(cwd, run.runId), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export async function loadRun(cwd: string, runId: string): Promise<PlaybookRunState | undefined> {
  return readJsonIfExists<PlaybookRunState>(runFile(cwd, runId));
}

export async function listRunIds(cwd: string): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(runsDir(cwd));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  return files
    .filter((file) => file.endsWith(".json") && file !== ACTIVE_FILE)
    .map((file) => file.replace(/\.json$/, ""))
    .sort();
}

export async function setActiveRun(cwd: string, runId: string): Promise<void> {
  await mkdir(runsDir(cwd), { recursive: true });
  const state: ActiveRunState = { runId };
  await writeFile(activeFile(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function loadActiveRunId(cwd: string): Promise<string | undefined> {
  const state = await readJsonIfExists<ActiveRunState>(activeFile(cwd));
  return typeof state?.runId === "string" ? state.runId : undefined;
}

export async function clearActiveRun(cwd: string): Promise<void> {
  await rm(activeFile(cwd), { force: true });
}

export function createRunId(playbookId: string, runName?: string): string {
  const base = slugify(runName ?? playbookId);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${base}-${stamp}`;
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "playbook-run";
}
