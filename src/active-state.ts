import { rm } from "node:fs/promises";
import { readJsonIfExists } from "./fs-errors.js";
import { writeJsonFile } from "./json-files.js";

export async function saveActiveId(path: string, field: string, id: string): Promise<void> {
  await writeJsonFile(path, { [field]: id });
}

export async function loadActiveId(
  path: string,
  field: string,
  isValid: (id: string) => boolean = () => true,
): Promise<string | undefined> {
  const state = await readJsonIfExists<Record<string, unknown>>(path);
  const id = state?.[field];
  return typeof id === "string" && isValid(id) ? id : undefined;
}

export async function clearActiveId(path: string): Promise<void> {
  await rm(path, { force: true });
}
