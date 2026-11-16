import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { clearActiveId, loadActiveId, saveActiveId } from "./active-state.js";
import { isNotFound, readJsonResult, stateShapeProblem } from "./fs-errors.js";
import { writeJsonFile } from "./json-files.js";
import type { PlaybookRunState } from "./types.js";

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
  await writeJsonFile(runFile(cwd, run.runId), run);
}

export async function loadRun(cwd: string, runId: string): Promise<PlaybookRunState | undefined> {
  const result = await loadRunSafe(cwd, runId);
  if (result.error) throw result.error;
  return result.run;
}

export type SafeRunLoad =
  | { run: PlaybookRunState | undefined; error?: undefined; path?: undefined }
  | { run?: undefined; error: Error; path: string };

/**
 * Load one run file without throwing. A missing file yields `{ run: undefined }`;
 * a damaged file yields `{ error, path }` whose message names the path so a
 * listing can skip it and report it while healthy runs stay usable.
 */
export async function loadRunSafe(cwd: string, runId: string): Promise<SafeRunLoad> {
  const path = runFile(cwd, runId);
  const result = await readJsonResult<unknown>(path);
  if (result.problem) return { error: new Error(result.problem.message, { cause: result.problem.error }), path: result.problem.path };
  if (result.value === undefined) return { run: undefined };
  // Parseable JSON is not enough: a hand-edited file can still lack the fields
  // every listing reads, which used to throw inside the history sort.
  const mismatch = describeRunShapeMismatch(result.value);
  if (mismatch) {
    const problem = stateShapeProblem(path, mismatch);
    return { error: new Error(problem.message, { cause: problem.error }), path };
  }
  return { run: result.value as PlaybookRunState };
}

export interface RunScan {
  /** Readable run states; damaged or missing files are omitted. */
  runs: PlaybookRunState[];
  /** One actionable message per damaged run file, naming the path. */
  problems: string[];
}

/**
 * Load every run-state file, tolerating damaged ones. Callers decide which
 * status they need, so both history and active-run selection share one pass.
 */
export async function scanRuns(cwd: string): Promise<RunScan> {
  const ids = await listRunIds(cwd);
  const loads = await Promise.all(ids.map((id) => loadRunSafe(cwd, id)));
  const runs: PlaybookRunState[] = [];
  const problems: string[] = [];
  for (const load of loads) {
    if (load.error) {
      problems.push(load.error.message);
      continue;
    }
    if (load.run) runs.push(load.run);
  }
  return { runs, problems };
}

/** Read the active pointer without throwing; a damaged pointer reports its path. */
export async function loadActiveRunIdSafe(cwd: string): Promise<{ runId?: string; problem?: string }> {
  const result = await readJsonResult<Record<string, unknown>>(activeFile(cwd));
  if (result.problem) return { problem: result.problem.message };
  const runId = result.value?.runId;
  return typeof runId === "string" ? { runId } : {};
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
  await saveActiveId(activeFile(cwd), "runId", runId);
}

export async function loadActiveRunId(cwd: string): Promise<string | undefined> {
  return loadActiveId(activeFile(cwd), "runId");
}

export async function clearActiveRun(cwd: string): Promise<void> {
  await clearActiveId(activeFile(cwd));
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

/** Expected run-state shape, phrased for the state-file problem message. */
const RUN_STATE_SHAPE = 'string "status", string "updatedAt" and array "history"';
/** Fields every history entry must carry for the listing renderers. */
const HISTORY_ENTRY_FIELDS = ["at", "step", "outcome", "to"] as const;

/** Describe what a parsed run file should have been, or why it is unusable. */
function describeRunShapeMismatch(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `expected a run state object with ${RUN_STATE_SHAPE}`;
  }
  const record = value as Record<string, unknown>;
  const fields: Array<[keyof PlaybookRunState, (field: unknown) => boolean, string]> = [
    ["status", (field) => typeof field === "string", "a string"],
    ["updatedAt", (field) => typeof field === "string", "a string"],
    ["history", (field) => Array.isArray(field), "an array"],
  ];
  for (const [field, isValid, expected] of fields) {
    if (!isValid(record[field])) {
      return `field "${field}" is ${describeJsonType(record[field])} instead of ${expected}; expected ${RUN_STATE_SHAPE}`;
    }
  }
  // History entries are rendered field by field, so one malformed entry breaks
  // the same listing this validation exists to protect.
  for (const [index, entry] of (record.history as unknown[]).entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return `history entry ${index} is ${describeJsonType(entry)} instead of an object; expected ${RUN_STATE_SHAPE}`;
    }
    for (const field of HISTORY_ENTRY_FIELDS) {
      const entryValue = (entry as Record<string, unknown>)[field];
      if (typeof entryValue !== "string") {
        return `history entry ${index} field "${field}" is ${describeJsonType(entryValue)} instead of a string; expected ${RUN_STATE_SHAPE}`;
      }
    }
  }
  return undefined;
}

function describeJsonType(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
