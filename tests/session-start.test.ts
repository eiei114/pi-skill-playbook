import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import piSkillPlaybook from "../extensions/index.js";
import { activeFile, runFile, saveRun } from "../src/state.js";
import type { PlaybookRunState } from "../src/types.js";

class RecordingUi {
  notifications: Array<{ message: string; level: "info" | "warning" | "error" }> = [];
  widgets: Array<{ key: string; content: string[] | undefined }> = [];

  notify(message: string, level: "info" | "warning" | "error") {
    this.notifications.push({ message, level });
  }

  setWidget(key: string, content: string[] | undefined) {
    this.widgets.push({ key, content });
  }
}

/** Register the real extension against a fake host so session_start can be driven directly. */
function registerExtension() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
  const commands: string[] = [];
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers[event] = handler;
    },
    registerCommand: (name: string) => commands.push(name),
    getCommands: () => [],
  };
  piSkillPlaybook(pi as never);
  return { handlers, commands };
}

async function runSessionStart(cwd: string): Promise<RecordingUi> {
  const ui = new RecordingUi();
  const { handlers } = registerExtension();
  const ctx = { cwd, hasUI: true, ui };
  await handlers.session_start({ type: "session_start" }, ctx);
  return ui;
}

test("session_start with a corrupt active pointer does not throw and reports it once", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-session-corrupt-active-"));
  try {
    await mkdir(join(cwd, ".pi", "playbook-runs"), { recursive: true });
    await writeFile(activeFile(cwd), "{oops", "utf8");

    const ui = await runSessionStart(cwd);

    assert.equal(ui.notifications.length, 1);
    const { message, level } = ui.notifications[0];
    assert.equal(level, "warning");
    assert.match(message, /active\.json/);
    assert.match(message, /cannot be read: invalid JSON/);
    assert.match(message, /Repair or delete/);
    assert.doesNotMatch(message, /Unexpected token/);
    assert.deepEqual(ui.widgets, [{ key: "pi-skill-playbook", content: undefined }]);
    // Nothing was deleted or rewritten automatically.
    assert.equal(await readFile(activeFile(cwd), "utf8"), "{oops");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("session_start with a corrupt active run file does not throw and reports it once", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-session-corrupt-run-"));
  try {
    await mkdir(join(cwd, ".pi", "playbook-runs"), { recursive: true });
    await writeFile(runFile(cwd, "host-run"), "not valid json", "utf8");
    await writeFile(activeFile(cwd), JSON.stringify({ runId: "host-run" }), "utf8");

    const ui = await runSessionStart(cwd);

    assert.equal(ui.notifications.length, 1);
    const { message, level } = ui.notifications[0];
    assert.equal(level, "warning");
    assert.match(message, /host-run\.json/);
    assert.match(message, /invalid JSON/);
    assert.match(message, /Repair or delete/);
    assert.equal(await readFile(runFile(cwd, "host-run"), "utf8"), "not valid json");
    assert.equal(await readFile(activeFile(cwd), "utf8"), JSON.stringify({ runId: "host-run" }));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("session_start with healthy state still restores the run widget without notifications", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-session-healthy-"));
  try {
    const now = new Date().toISOString();
    const run: PlaybookRunState = {
      runId: "healthy-run",
      playbookId: "feature-development",
      playbookPath: ".pi/playbooks/feature-development.yml",
      currentStep: "grill",
      status: "active",
      createdAt: now,
      updatedAt: now,
      history: [],
    };
    await saveRun(cwd, run);
    await writeFile(activeFile(cwd), JSON.stringify({ runId: run.runId }), "utf8");

    const ui = await runSessionStart(cwd);

    assert.equal(ui.notifications.length, 0);
    assert.equal(ui.widgets.length, 1);
    // A missing playbook is reported in the widget instead of breaking session start.
    assert.match((ui.widgets[0].content ?? []).join("\n"), /references missing playbook/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
