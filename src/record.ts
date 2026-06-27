import type { PlaybookDefinition, PlaybookSkillDefinition } from "./types.js";
import type { RecordMark, RecordSession, RecordedStepDraft } from "./record-types.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function createRecordSession(playbookId: string, playbookName: string, now = new Date().toISOString()): RecordSession {
  validatePlaybookId(playbookId);
  return {
    sessionId: `record-${playbookId}-${stamp(now)}`,
    playbookId,
    playbookName,
    status: "recording",
    createdAt: now,
    updatedAt: now,
    entryStepId: null,
    currentStepId: null,
    steps: {},
    pendingBranch: null,
    marks: [],
  };
}

export function markSkill(session: RecordSession, skillName: string, now = new Date().toISOString()): RecordSession {
  const normalizedSkillName = skillName.trim();
  validateSkillName(normalizedSkillName);
  const next = cloneSession(session);

  if (next.pendingBranch) {
    const step = createStep(normalizedSkillName, next.steps);
    next.steps[step.id] = step;
    linkPendingBranch(next, step.id);
    next.entryStepId ??= step.id;
    next.currentStepId = step.id;
    next.marks.push({ at: now, kind: "skill", skillName: normalizedSkillName });
    next.updatedAt = now;
    return next;
  }

  if (!next.currentStepId) {
    const step = createStep(normalizedSkillName, next.steps);
    next.steps[step.id] = step;
    next.entryStepId = step.id;
    next.currentStepId = step.id;
    next.marks.push({ at: now, kind: "skill", skillName: normalizedSkillName });
    next.updatedAt = now;
    return next;
  }

  const current = next.steps[next.currentStepId];
  if (!current) throw new Error(`Current step '${next.currentStepId}' is missing.`);
  if (!current.closed) {
    throw new Error(`Step '${current.id}' is still open. Run /playbook:record:branch <outcome> before marking the next skill.`);
  }

  throw new Error("No pending branch outcome. Run /playbook:record:branch <outcome> before marking the next skill.");
}

export function recordBranch(
  session: RecordSession,
  outcome: string,
  toStepId?: string,
  now = new Date().toISOString(),
): RecordSession {
  const label = outcome.trim();
  if (!label) throw new Error("Branch outcome label is required.");

  const next = cloneSession(session);
  if (!next.currentStepId) throw new Error("No step is open. Run /playbook:record:mark first.");

  const current = next.steps[next.currentStepId];
  if (!current) throw new Error(`Current step '${next.currentStepId}' is missing.`);
  if (current.closed) throw new Error(`Step '${current.id}' is already closed.`);

  if (current.transitions.some((transition) => transition.outcome === label)) {
    throw new Error(`Outcome '${label}' is already recorded for step '${current.id}'.`);
  }

  if (toStepId) {
    if (!(toStepId in next.steps)) throw new Error(`Target step '${toStepId}' does not exist.`);
    current.transitions.push({ outcome: label, to: toStepId });
    current.closed = true;
    next.currentStepId = toStepId;
    next.pendingBranch = null;
    next.marks.push({ at: now, kind: "branch", outcome: label, toStepId });
    next.updatedAt = now;
    return next;
  }

  current.transitions.push({ outcome: label, to: "pending" });
  current.closed = true;
  next.pendingBranch = { fromStepId: current.id, outcome: label };
  next.currentStepId = null;
  next.marks.push({ at: now, kind: "branch", outcome: label });
  next.updatedAt = now;
  return next;
}

export function finalizeRecordSession(session: RecordSession, now = new Date().toISOString()): RecordSession {
  const next = cloneSession(session);
  if (!next.entryStepId) throw new Error("Recording is empty. Mark at least one skill before stopping.");

  if (next.pendingBranch) {
    throw new Error(`Pending branch outcome '${next.pendingBranch.outcome}' needs a target skill mark.`);
  }

  if (next.currentStepId) {
    const current = next.steps[next.currentStepId];
    if (current && !current.closed) {
      current.transitions.push({ outcome: "complete", to: "complete" });
      current.closed = true;
    }
  }

  for (const step of Object.values(next.steps)) {
    for (const transition of step.transitions) {
      if (transition.to === "pending") {
        throw new Error(`Step '${step.id}' still has an unresolved branch target.`);
      }
    }
  }

  next.updatedAt = now;
  return next;
}

export function recordSessionToDefinition(session: RecordSession): PlaybookDefinition {
  const finalized = finalizeRecordSession(session);
  const skills: Record<string, PlaybookSkillDefinition> = {};
  const steps: PlaybookDefinition["steps"] = {};

  for (const step of Object.values(finalized.steps)) {
    if (!(step.primarySkill in skills)) {
      skills[step.primarySkill] = { role: step.id === finalized.entryStepId ? "entry" : "internal" };
    }
    steps[step.id] = {
      primarySkill: step.primarySkill,
      commandHint: step.commandHint,
      doneWhen: step.doneWhen,
      transitions: step.transitions.map((transition) => ({
        outcome: transition.outcome,
        to: transition.to,
      })),
    };
  }

  return {
    version: 1,
    id: finalized.playbookId,
    name: finalized.playbookName,
    entry: finalized.entryStepId!,
    autoAdvance: "auto",
    skills,
    steps,
  };
}

export function renderRecordStatus(session: RecordSession): string[] {
  const lines = [
    `Recording ${session.playbookId} (${session.playbookName})`,
    `Session: ${session.sessionId}`,
    `Steps: ${Object.keys(session.steps).length}`,
    `Marks: ${session.marks.length}`,
  ];
  if (session.currentStepId) {
    const step = session.steps[session.currentStepId];
    lines.push(`Current step: ${session.currentStepId}${step?.closed ? " (closed)" : " (open)"}`);
  } else if (session.pendingBranch) {
    lines.push(`Pending branch: ${session.pendingBranch.outcome} → awaiting next skill mark`);
  }
  return lines;
}

export function validatePlaybookId(playbookId: string): void {
  if (!ID_PATTERN.test(playbookId)) {
    throw new Error(`Playbook id '${playbookId}' must be lower-kebab-case.`);
  }
}

function createStep(skillName: string, existing: Record<string, RecordedStepDraft>): RecordedStepDraft {
  const id = uniqueStepId(skillName, existing);
  return {
    id,
    primarySkill: skillName,
    commandHint: `/skill:${skillName}`,
    doneWhen: [`Recorded completion criteria for ${skillName}.`],
    transitions: [],
    closed: false,
  };
}

function uniqueStepId(skillName: string, existing: Record<string, RecordedStepDraft>): string {
  const base = skillName.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "step";
  if (!(base in existing)) return base;
  let index = 2;
  while (`${base}-${index}` in existing) index += 1;
  return `${base}-${index}`;
}

function linkPendingBranch(session: RecordSession, toStepId: string): void {
  if (!session.pendingBranch) return;
  const from = session.steps[session.pendingBranch.fromStepId];
  if (!from) throw new Error(`Pending branch source '${session.pendingBranch.fromStepId}' is missing.`);
  const transition = from.transitions.find((candidate) => candidate.outcome === session.pendingBranch!.outcome);
  if (!transition) throw new Error(`Pending branch outcome '${session.pendingBranch.outcome}' is missing.`);
  transition.to = toStepId;
  session.pendingBranch = null;
}

function validateSkillName(skillName: string): void {
  if (!skillName.trim()) throw new Error("Skill name is required.");
}

function cloneSession(session: RecordSession): RecordSession {
  return structuredClone(session);
}

function stamp(now: string): string {
  return now.replace(/[-:.TZ]/g, "");
}
