import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  try {
    return JSON.parse(await readFile(runFile(cwd, runId), "utf8")) as PlaybookRunState;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function setActiveRun(cwd: string, runId: string): Promise<void> {
  await mkdir(runsDir(cwd), { recursive: true });
  const state: ActiveRunState = { runId };
  await writeFile(activeFile(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function loadActiveRunId(cwd: string): Promise<string | undefined> {
  try {
    const state = JSON.parse(await readFile(activeFile(cwd), "utf8")) as ActiveRunState;
    return typeof state.runId === "string" ? state.runId : undefined;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
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

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
