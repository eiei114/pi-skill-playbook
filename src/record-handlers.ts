import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { savePlaybookDraft } from "./draft-save.js";
import {
  createRecordSession,
  markSkill,
  recordBranch,
  recordSessionToDefinition,
  renderRecordStatus,
  validatePlaybookId,
} from "./record.js";
import {
  clearActiveRecordSession,
  loadActiveRecordSession,
  saveRecordSession,
  setActiveRecordSession,
} from "./record-state.js";
import { normalizeSkillCommandName } from "./validation.js";

type RecordUi = {
  notify(message: string, level: "info" | "warning" | "error"): void;
  select?(title: string, options: string[]): Promise<string | undefined>;
  confirm?(title: string, message: string): Promise<boolean>;
};

type RecordContext = {
  cwd: string;
  hasUI: boolean;
  ui?: RecordUi;
};

export const RECORD_COMMANDS = [
  ["record:start", "start recording an explicit skill flow"],
  ["record:mark", "mark explicit skill usage in the active recording"],
  ["record:branch", "record a branch outcome label"],
  ["record:stop", "stop recording and save a playbook draft"],
  ["record:status", "show active recording status"],
] as const;

export function recordUsage(): string {
  return [
    "Usage:",
    "/playbook:record:start <playbook-id> [--name <display name>]",
    "/playbook:record:mark [<skill-name>]",
    "/playbook:record:branch <outcome-label> [--to <step-id>]",
    "/playbook:record:stop",
    "/playbook:record:status",
  ].join("\n");
}

export async function handleRecordCommand(
  pi: ExtensionAPI,
  command: string,
  args: string,
  ctx: RecordContext,
): Promise<void> {
  const ui = ctx.hasUI ? ctx.ui : undefined;
  const tokens = tokenize(args);

  switch (command) {
    case "record":
      if (tokens.length === 0) {
        await showRecordStatus(ctx.cwd, ui);
        notify(ui, recordUsage(), "info");
        return;
      }
      notify(ui, recordUsage(), "error");
      return;
    case "record:start":
      await startRecording(tokens, ctx.cwd, ui);
      return;
    case "record:mark":
      await markRecordingSkill(pi, tokens, ctx.cwd, ui);
      return;
    case "record:branch":
      await branchRecording(tokens, ctx.cwd, ui);
      return;
    case "record:stop":
      await stopRecording(pi, ctx.cwd, ui);
      return;
    case "record:status":
      await showRecordStatus(ctx.cwd, ui);
      return;
    default:
      notify(ui, recordUsage(), "error");
  }
}

async function startRecording(tokens: string[], cwd: string, ui: RecordUi | undefined): Promise<void> {
  const playbookId = tokens[0];
  if (!playbookId) {
    notify(ui, "Playbook id is required. Example: /playbook:record:start my-recorded-flow", "error");
    return;
  }

  validatePlaybookId(playbookId);
  const nameFlag = tokens.indexOf("--name");
  const playbookName = nameFlag >= 0 ? tokens[nameFlag + 1] : titleCase(playbookId);

  const existing = await loadActiveRecordSession(cwd);
  if (existing) {
    notify(ui, `Recording already active (${existing.playbookId}). Run /playbook:record:stop first.`, "warning");
    return;
  }

  const session = createRecordSession(playbookId, playbookName);
  await saveRecordSession(cwd, session);
  await setActiveRecordSession(cwd, session.sessionId);
  notify(ui, [`Started recording ${playbookId}.`, ...renderRecordStatus(session)].join("\n"), "info");
}

async function markRecordingSkill(
  pi: ExtensionAPI,
  tokens: string[],
  cwd: string,
  ui: RecordUi | undefined,
): Promise<void> {
  const session = await requireActiveSession(cwd, ui);
  if (!session) return;

  let skillName = tokens[0];
  if (!skillName) {
    const selected = await pickSkill(pi, ui);
    if (!selected) return;
    skillName = selected;
  } else {
    skillName = normalizeSkillCommandName(skillName);
  }

  const updated = markSkill(session, skillName);
  await saveRecordSession(cwd, updated);
  notify(ui, [`Marked skill '${skillName}' on step '${updated.currentStepId}'.`, ...renderRecordStatus(updated)].join("\n"), "info");
}

async function branchRecording(tokens: string[], cwd: string, ui: RecordUi | undefined): Promise<void> {
  const session = await requireActiveSession(cwd, ui);
  if (!session) return;

  const outcome = tokens[0];
  if (!outcome) {
    notify(ui, "Outcome label is required. Example: /playbook:record:branch ready-for-prd", "error");
    return;
  }

  const toFlag = tokens.indexOf("--to");
  const toStepId = toFlag >= 0 ? tokens[toFlag + 1] : undefined;
  const updated = recordBranch(session, outcome, toStepId);
  await saveRecordSession(cwd, updated);
  notify(ui, [`Recorded branch outcome '${outcome}'.`, ...renderRecordStatus(updated)].join("\n"), "info");
}

async function stopRecording(pi: ExtensionAPI, cwd: string, ui: RecordUi | undefined): Promise<void> {
  const session = await requireActiveSession(cwd, ui);
  if (!session) return;

  const definition = recordSessionToDefinition(session);
  const saved = await savePlaybookDraft(cwd, definition, getAvailableSkills(pi), ui, { sourceLabel: "Recorded" });
  if (saved) {
    await clearActiveRecordSession(cwd);
    notify(ui, `Recording ${session.playbookId} converted to playbook draft.`, "info");
  }
}

async function showRecordStatus(cwd: string, ui: RecordUi | undefined): Promise<void> {
  const session = await loadActiveRecordSession(cwd);
  if (!session) {
    notify(ui, "No active recording. Start one with /playbook:record:start <playbook-id>.", "info");
    return;
  }
  notify(ui, renderRecordStatus(session).join("\n"), "info");
}

async function requireActiveSession(cwd: string, ui: RecordUi | undefined) {
  const session = await loadActiveRecordSession(cwd);
  if (!session) {
    notify(ui, "No active recording. Start one with /playbook:record:start <playbook-id>.", "error");
    return undefined;
  }
  return session;
}

async function pickSkill(pi: ExtensionAPI, ui: RecordUi | undefined): Promise<string | undefined> {
  const skills = [...getAvailableSkills(pi)].sort();
  if (skills.length === 0) {
    notify(ui, "No Agent Skills are available to mark.", "error");
    return undefined;
  }
  if (!ui?.select) {
    notify(ui, "Skill name is required when selection UI is unavailable. Example: /playbook:record:mark grill-with-docs", "error");
    return undefined;
  }
  const selected = await ui.select("Mark which skill?", skills);
  return selected ? normalizeSkillCommandName(selected) : undefined;
}

function getAvailableSkills(pi: ExtensionAPI): ReadonlySet<string> {
  const skills = pi.getCommands()
    .filter((command) => command.source === "skill")
    .map((command) => normalizeSkillCommandName(command.name));
  return new Set(skills);
}

function tokenize(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function notify(ui: RecordUi | undefined, message: string, level: "info" | "warning" | "error"): void {
  ui?.notify(message, level);
}
