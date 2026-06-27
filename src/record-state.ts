import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecordSession } from "./record-types.js";

export const RECORDS_DIR = ".pi/playbook-records";
const ACTIVE_FILE = "active.json";
const SESSION_ID_PATTERN = /^record-[a-z0-9][a-z0-9-]*-\d+$/;

function assertValidSessionId(sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Invalid record session id '${sessionId}'.`);
  }
  return sessionId;
}

export function recordsDir(cwd: string): string {
  return join(cwd, RECORDS_DIR);
}

export function sessionFile(cwd: string, sessionId: string): string {
  return join(recordsDir(cwd), `${assertValidSessionId(sessionId)}.json`);
}

export function activeRecordFile(cwd: string): string {
  return join(recordsDir(cwd), ACTIVE_FILE);
}

export async function saveRecordSession(cwd: string, session: RecordSession): Promise<void> {
  await mkdir(recordsDir(cwd), { recursive: true });
  await writeFile(sessionFile(cwd, session.sessionId), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export async function loadRecordSession(cwd: string, sessionId: string): Promise<RecordSession | undefined> {
  try {
    return JSON.parse(await readFile(sessionFile(cwd, sessionId), "utf8")) as RecordSession;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function setActiveRecordSession(cwd: string, sessionId: string): Promise<void> {
  assertValidSessionId(sessionId);
  await mkdir(recordsDir(cwd), { recursive: true });
  await writeFile(activeRecordFile(cwd), `${JSON.stringify({ sessionId }, null, 2)}\n`, "utf8");
}

export async function loadActiveRecordSessionId(cwd: string): Promise<string | undefined> {
  try {
    const state = JSON.parse(await readFile(activeRecordFile(cwd), "utf8")) as { sessionId?: string };
    return typeof state.sessionId === "string" && SESSION_ID_PATTERN.test(state.sessionId)
      ? state.sessionId
      : undefined;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function clearActiveRecordSession(cwd: string): Promise<void> {
  await rm(activeRecordFile(cwd), { force: true });
}

export async function loadActiveRecordSession(cwd: string): Promise<RecordSession | undefined> {
  const sessionId = await loadActiveRecordSessionId(cwd);
  if (!sessionId) return undefined;
  return loadRecordSession(cwd, sessionId);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
