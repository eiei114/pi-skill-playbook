import { join } from "node:path";
import { clearActiveId, loadActiveId, saveActiveId } from "./active-state.js";
import { readJsonIfExists } from "./fs-errors.js";
import { writeJsonFile } from "./json-files.js";
import type { RecordSession } from "./record-types.js";

export const RECORDS_DIR = ".pi/playbook-records";
const ACTIVE_FILE = "active.json";
const SESSION_ID_PATTERN = /^record-[a-z0-9][a-z0-9-]*-\d+$/;

function assertValidSessionId(sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`Invalid record session id '${sessionId}'.`);
  }
  return sessionId;
}

function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
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
  await writeJsonFile(sessionFile(cwd, session.sessionId), session);
}

export async function loadRecordSession(cwd: string, sessionId: string): Promise<RecordSession | undefined> {
  return readJsonIfExists<RecordSession>(sessionFile(cwd, sessionId));
}

export async function setActiveRecordSession(cwd: string, sessionId: string): Promise<void> {
  assertValidSessionId(sessionId);
  await saveActiveId(activeRecordFile(cwd), "sessionId", sessionId);
}

export async function loadActiveRecordSessionId(cwd: string): Promise<string | undefined> {
  return loadActiveId(activeRecordFile(cwd), "sessionId", isValidSessionId);
}

export async function clearActiveRecordSession(cwd: string): Promise<void> {
  await clearActiveId(activeRecordFile(cwd));
}

export async function loadActiveRecordSession(cwd: string): Promise<RecordSession | undefined> {
  const sessionId = await loadActiveRecordSessionId(cwd);
  if (!sessionId) return undefined;
  return loadRecordSession(cwd, sessionId);
}
