import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateDraftDefinition, savePlaybookDraft } from "../src/draft-save.js";
import {
  createRecordSession,
  markSkill,
  recordBranch,
  recordSessionToDefinition,
  renderRecordStatus,
} from "../src/record.js";
import {
  clearActiveRecordSession,
  loadActiveRecordSession,
  saveRecordSession,
  setActiveRecordSession,
} from "../src/record-state.js";
import { handleRecordCommand } from "../src/record-handlers.js";
import type { PlaybookDefinition } from "../src/types.js";

const skills = new Set(["grill-with-docs", "to-prd", "to-issues"]);

test("record state transitions build a linear draft", () => {
  let session = createRecordSession("my-flow", "My Flow", "2026-06-01T00:00:00.000Z");
  session = markSkill(session, "grill-with-docs");
  session = recordBranch(session, "ready-for-prd");
  session = markSkill(session, "to-prd");
  session = recordBranch(session, "ready-for-issues");
  session = markSkill(session, "to-issues");

  const definition = recordSessionToDefinition(session);
  assert.equal(definition.id, "my-flow");
  assert.equal(definition.entry, "grill-with-docs");
  assert.equal(definition.steps["grill-with-docs"].transitions[0].outcome, "ready-for-prd");
  assert.equal(definition.steps["grill-with-docs"].transitions[0].to, "to-prd");
  assert.equal(definition.steps["to-issues"].transitions[0].to, "complete");
});

test("branch requires user-supplied outcome labels", () => {
  const session = markSkill(createRecordSession("branchy", "Branchy"), "grill-with-docs");
  assert.throws(() => recordBranch(session, "   "), /Branch outcome label is required/);
});

test("mark after an open step requires an explicit branch", () => {
  const session = markSkill(createRecordSession("blocked", "Blocked"), "grill-with-docs");
  assert.throws(() => markSkill(session, "to-prd"), /Run \/playbook:record:branch/);
});

test("recorded draft validation blocks missing skills", () => {
  const session = markSkill(createRecordSession("missing-skill", "Missing Skill"), "unknown-skill");
  const definition = recordSessionToDefinition(session);
  const { result } = validateDraftDefinition(definition, ".pi/playbooks/missing-skill.yml", skills);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /not an available Agent Skill/);
});

test("recorded draft validation passes with discovered skills", () => {
  let session = createRecordSession("valid", "Valid");
  session = markSkill(session, "grill-with-docs");
  session = recordBranch(session, "next");
  session = markSkill(session, "to-prd");
  const definition = recordSessionToDefinition(session);
  const { result } = validateDraftDefinition(definition, ".pi/playbooks/valid.yml", skills);
  assert.equal(result.valid, true);
});

test("renderRecordStatus shows pending branch state", () => {
  let session = markSkill(createRecordSession("status", "Status"), "grill-with-docs");
  session = recordBranch(session, "ready-for-prd");
  const lines = renderRecordStatus(session);
  assert.match(lines.join("\n"), /Pending branch: ready-for-prd/);
});

test("record session persistence round-trips", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-record-state-"));
  try {
    const session = markSkill(createRecordSession("persisted", "Persisted"), "grill-with-docs");
    await saveRecordSession(cwd, session);
    await setActiveRecordSession(cwd, session.sessionId);
    const loaded = await loadActiveRecordSession(cwd);
    assert.equal(loaded?.playbookId, "persisted");
    assert.equal(loaded?.currentStepId, "grill-with-docs");
    await clearActiveRecordSession(cwd);
    assert.equal(await loadActiveRecordSession(cwd), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("handleRecordCommand stop saves a validated draft after confirm", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-record-stop-"));
  try {
    const ui = new MockUi();
    const pi = {
      getCommands: () => [
        { source: "skill", name: "skill:grill-with-docs" },
        { source: "skill", name: "skill:to-prd" },
      ],
    };

    await handleRecordCommand(pi as any, "record:start", "recorded-flow --name Recorded Flow", { cwd, hasUI: true, ui });
    await handleRecordCommand(pi as any, "record:mark", "grill-with-docs", { cwd, hasUI: true, ui });
    await handleRecordCommand(pi as any, "record:branch", "ready-for-prd", { cwd, hasUI: true, ui });
    await handleRecordCommand(pi as any, "record:mark", "to-prd", { cwd, hasUI: true, ui });
    await handleRecordCommand(pi as any, "record:stop", "", { cwd, hasUI: true, ui });

    const saved = await readFile(join(cwd, ".pi/playbooks/recorded-flow.yml"), "utf8");
    assert.match(saved, /id: recorded-flow/);
    assert.match(saved, /primarySkill: grill-with-docs/);
    assert.equal(await loadActiveRecordSession(cwd), undefined);
    assert.equal(ui.confirms.length, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("savePlaybookDraft blocks save when validation fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-draft-save-"));
  try {
    await mkdir(join(cwd, ".pi/playbooks"), { recursive: true });
    const ui = new MockUi();
    const definition: PlaybookDefinition = {
      version: 1,
      id: "broken",
      name: "Broken",
      entry: "missing",
      skills: { "missing-skill": { role: "entry" } },
      steps: {
        missing: {
          primarySkill: "missing-skill",
          commandHint: "/skill:missing-skill",
          doneWhen: ["x"],
          transitions: [],
        },
      },
    };

    const saved = await savePlaybookDraft(cwd, definition, skills, ui, { sourceLabel: "Recorded" });
    assert.equal(saved, false);
    assert.equal(ui.notifications.some((entry) => entry.level === "error"), true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

class MockUi {
  notifications: Array<{ message: string; level: "info" | "warning" | "error" }> = [];
  confirms: Array<{ title: string; message: string }> = [];

  notify(message: string, level: "info" | "warning" | "error") {
    this.notifications.push({ message, level });
  }

  async confirm(title: string, message: string) {
    this.confirms.push({ title, message });
    return true;
  }
}
