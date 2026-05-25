import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePlaybookYaml } from "./validation.js";
import type { LoadedPlaybook } from "./types.js";

export const PLAYBOOK_DIR = ".pi/playbooks";

export async function loadPlaybooks(cwd: string): Promise<LoadedPlaybook[]> {
  const dir = join(cwd, PLAYBOOK_DIR);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const yamlFiles = files.filter((file) => /\.ya?ml$/i.test(file));
  const playbooks: LoadedPlaybook[] = [];
  for (const file of yamlFiles) {
    const fullPath = join(dir, file);
    const source = await readFile(fullPath, "utf8");
    playbooks.push(parsePlaybookYaml(source, fullPath));
  }
  return playbooks;
}

export async function findPlaybook(cwd: string, id: string): Promise<LoadedPlaybook | undefined> {
  const playbooks = await loadPlaybooks(cwd);
  return playbooks.find((playbook) => playbook.definition.id === id);
}
