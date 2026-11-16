import { readFile } from "node:fs/promises";

export function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

export interface JsonReadProblem {
  /** Path of the unreadable file, so callers can name it in messages. */
  path: string;
  /** Original error, kept so strict callers can rethrow exactly what happened. */
  error: unknown;
  /** Actionable message naming the path; safe to show to users. */
  message: string;
}

export type JsonReadResult<T> =
  | { value: T | undefined; problem?: undefined }
  | { value?: undefined; problem: JsonReadProblem };

export async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  const result = await readJsonResult<T>(path);
  if (result.problem) throw result.problem.error;
  return result.value;
}

/**
 * Read optional JSON state without throwing. A missing file yields
 * `{ value: undefined }`; an unreadable or invalid file yields `{ problem }`
 * naming the path so callers can skip the damaged file and report it.
 */
export async function readJsonResult<T>(path: string): Promise<JsonReadResult<T>> {
  try {
    return { value: JSON.parse(await readFile(path, "utf8")) as T };
  } catch (error) {
    if (isNotFound(error)) return { value: undefined };
    return { problem: stateFileProblem(path, error) };
  }
}

/** Build the actionable message used whenever a state file cannot be read. */
export function stateFileProblem(path: string, error: unknown): JsonReadProblem {
  return { path, error, message: `Playbook state file "${path}" cannot be read: ${describeReadFailure(error)}. The file was left unchanged; repair or delete it.` };
}

function describeReadFailure(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid JSON";
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
  return code ? `unreadable (${code})` : "unreadable";
}
