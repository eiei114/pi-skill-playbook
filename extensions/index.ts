import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clearActiveRun, createRunId, loadActiveRunId, loadRun, saveRun, setActiveRun } from "../src/state.js";
import { findPlaybook, loadPlaybooks } from "../src/playbooks.js";
import { getGitignoreAdvisory } from "../src/gitignore.js";
import { renderStepCard, renderValidationErrors } from "../src/render.js";
import { normalizeSkillCommandName, validatePlaybook, validateUniquePlaybookIds } from "../src/validation.js";
import type { LoadedPlaybook, PlaybookRunState } from "../src/types.js";

const WIDGET_ID = "pi-skill-playbook";

export default function piSkillPlaybook(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const activeRunId = await loadActiveRunId(ctx.cwd);
    if (!activeRunId) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }
    const run = await loadRun(ctx.cwd, activeRunId);
    if (!run || run.status === "completed") {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }
    const playbook = await findPlaybook(ctx.cwd, run.playbookId);
    if (!playbook) {
      ctx.ui.setWidget(WIDGET_ID, [`Playbook run '${run.runId}' references missing playbook '${run.playbookId}'.`], {
        placement: "belowEditor",
      });
      return;
    }
    ctx.ui.setWidget(WIDGET_ID, renderStepCard(playbook, run), { placement: "belowEditor" });
  });

  pi.registerCommand("playbook", {
    description: "Guide Agent Skill workflows with project-local playbooks",
    getArgumentCompletions: (prefix) => {
      const commands = ["list", "start", "resume", "status", "done", "choose"];
      const filtered = commands.filter((command) => command.startsWith(prefix.trim()));
      return filtered.length ? filtered.map((command) => ({ value: command, label: command })) : null;
    },
    handler: async (args, ctx) => {
      const parsed = parseArgs(args);
      const command = parsed.shift() ?? "status";

      try {
        switch (command) {
          case "list":
            await listPlaybooks(pi, ctx.cwd, ctx.hasUI ? ctx.ui : undefined);
            return;
          case "start":
            await startPlaybook(pi, ctx.cwd, parsed, ctx.hasUI ? ctx.ui : undefined);
            return;
          case "resume":
            await resumeRun(ctx.cwd, parsed, ctx.hasUI ? ctx.ui : undefined);
            return;
          case "status":
            await showStatus(ctx.cwd, parsed[0], ctx.hasUI ? ctx.ui : undefined);
            return;
          case "done":
            await completeCurrentStep(ctx.cwd, ctx.hasUI ? ctx.ui : undefined);
            return;
          case "choose":
            await chooseOutcome(ctx.cwd, parsed[0], ctx.hasUI ? ctx.ui : undefined);
            return;
          case "import-web":
          case "record":
            notify(ctx.hasUI ? ctx.ui : undefined, `/${command} is deferred after the Core 6 MVP scaffold.` , "warning");
            return;
          default:
            notify(ctx.hasUI ? ctx.ui : undefined, usage(), "error");
        }
      } catch (error) {
        notify(ctx.hasUI ? ctx.ui : undefined, error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}

async function listPlaybooks(pi: ExtensionAPI, cwd: string, ui: UiLike | undefined): Promise<void> {
  const playbooks = await loadPlaybooks(cwd);
  if (playbooks.length === 0) {
    notify(ui, "No playbooks found. Create .pi/playbooks/*.yml or copy samples/feature-development.yml.", "info");
    return;
  }

  const availableSkills = getAvailableSkills(pi);
  const duplicateResult = validateUniquePlaybookIds(playbooks);
  const lines = playbooks.flatMap((playbook) => {
    const result = validatePlaybook(playbook, availableSkills, { requireSkills: false });
    const marker = result.valid ? "ok" : "invalid";
    return [`${marker} ${playbook.definition.id} - ${playbook.definition.name}`, ...result.errors.map((error) => `  - ${error}`)];
  });
  if (!duplicateResult.valid) lines.push(...duplicateResult.errors.map((error) => `invalid ${error}`));
  notify(ui, lines.join("\n"), duplicateResult.valid ? "info" : "error");
}

async function startPlaybook(pi: ExtensionAPI, cwd: string, args: string[], ui: UiLike | undefined): Promise<void> {
  const playbookId = args[0];
  if (!playbookId) throw new Error("Usage: /playbook start <playbook-id> [--run <name>]");

  const playbook = await findPlaybook(cwd, playbookId);
  if (!playbook) throw new Error(`Playbook '${playbookId}' not found in .pi/playbooks/.`);

  const validation = validatePlaybook(playbook, getAvailableSkills(pi), { requireSkills: true });
  if (!validation.valid) {
    throw new Error(`Playbook validation failed:\n${renderValidationErrors(validation.errors)}`);
  }

  const runName = readFlagValue(args.slice(1), "--run");
  const now = new Date().toISOString();
  const run: PlaybookRunState = {
    runId: createRunId(playbook.definition.id, runName),
    playbookId: playbook.definition.id,
    playbookPath: playbook.path,
    currentStep: playbook.definition.entry,
    status: "active",
    createdAt: now,
    updatedAt: now,
    history: [],
  };

  await saveRun(cwd, run);
  await setActiveRun(cwd, run.runId);
  renderWidget(ui, playbook, run);
  const advisory = await getGitignoreAdvisory(cwd);
  notify(ui, [`Started ${run.runId}.`, ...(advisory ? ["", advisory] : [])].join("\n"), advisory ? "warning" : "info");
}

async function resumeRun(cwd: string, args: string[], ui: UiLike | undefined): Promise<void> {
  const runId = args[0];
  if (!runId) throw new Error("Usage: /playbook resume <run-id>");
  const run = await loadRun(cwd, runId);
  if (!run) throw new Error(`Run '${runId}' not found.`);
  if (run.status === "completed") throw new Error(`Run '${runId}' is already completed.`);
  const playbook = await findPlaybook(cwd, run.playbookId);
  if (!playbook) throw new Error(`Run '${runId}' references missing playbook '${run.playbookId}'.`);
  await setActiveRun(cwd, run.runId);
  renderWidget(ui, playbook, run);
  notify(ui, `Resumed ${run.runId}.`, "info");
}

async function showStatus(cwd: string, explicitRunId: string | undefined, ui: UiLike | undefined): Promise<void> {
  const runId = explicitRunId ?? (await loadActiveRunId(cwd));
  if (!runId) {
    notify(ui, "No active playbook run.", "info");
    clearWidget(ui);
    return;
  }
  const run = await loadRun(cwd, runId);
  if (!run) throw new Error(`Run '${runId}' not found.`);
  const playbook = await findPlaybook(cwd, run.playbookId);
  if (!playbook) throw new Error(`Run '${runId}' references missing playbook '${run.playbookId}'.`);
  const lines = renderStepCard(playbook, run);
  renderWidget(ui, playbook, run);
  const advisory = await getGitignoreAdvisory(cwd);
  notify(ui, [...lines, ...(advisory ? ["", advisory] : [])].join("\n"), advisory ? "warning" : "info");
}

async function completeCurrentStep(cwd: string, ui: UiLike | undefined): Promise<void> {
  const { run, playbook } = await loadActive(cwd);
  const step = playbook.definition.steps[run.currentStep];
  if (!step) throw new Error(`Current step '${run.currentStep}' is missing.`);

  if (step.transitions.length === 0) {
    await completeRun(cwd, playbook, run, "complete", "complete", ui);
    return;
  }
  if (step.transitions.length > 1) {
    notify(ui, `Step attested. Choose outcome: ${step.transitions.map((t) => t.outcome).join(", ")}`, "info");
    renderWidget(ui, playbook, run);
    return;
  }
  await advanceRun(cwd, playbook, run, step.transitions[0].outcome, ui);
}

async function chooseOutcome(cwd: string, outcome: string | undefined, ui: UiLike | undefined): Promise<void> {
  if (!outcome) throw new Error("Usage: /playbook choose <outcome>");
  const { run, playbook } = await loadActive(cwd);
  await advanceRun(cwd, playbook, run, outcome, ui);
}

async function advanceRun(cwd: string, playbook: LoadedPlaybook, run: PlaybookRunState, outcome: string, ui: UiLike | undefined): Promise<void> {
  const step = playbook.definition.steps[run.currentStep];
  if (!step) throw new Error(`Current step '${run.currentStep}' is missing.`);
  const transition = step.transitions.find((candidate) => candidate.outcome === outcome);
  if (!transition) {
    throw new Error(`Outcome '${outcome}' is not valid for step '${run.currentStep}'. Valid: ${step.transitions.map((t) => t.outcome).join(", ")}`);
  }
  await completeRun(cwd, playbook, run, transition.outcome, transition.to, ui);
}

async function completeRun(cwd: string, playbook: LoadedPlaybook, run: PlaybookRunState, outcome: string, to: string, ui: UiLike | undefined): Promise<void> {
  const now = new Date().toISOString();
  run.history.push({ at: now, step: run.currentStep, outcome, to });
  run.updatedAt = now;

  if (to === "complete") {
    run.status = "completed";
    await saveRun(cwd, run);
    await clearActiveRun(cwd);
    clearWidget(ui);
    notify(ui, `Completed playbook run ${run.runId}.`, "info");
    return;
  }

  run.currentStep = to;
  await saveRun(cwd, run);
  await setActiveRun(cwd, run.runId);
  renderWidget(ui, playbook, run);
  notify(ui, `Advanced to '${to}'.`, "info");
}

async function loadActive(cwd: string): Promise<{ run: PlaybookRunState; playbook: LoadedPlaybook }> {
  const runId = await loadActiveRunId(cwd);
  if (!runId) throw new Error("No active playbook run.");
  const run = await loadRun(cwd, runId);
  if (!run) throw new Error(`Active run '${runId}' not found.`);
  if (run.status === "completed") throw new Error(`Active run '${runId}' is completed.`);
  const playbook = await findPlaybook(cwd, run.playbookId);
  if (!playbook) throw new Error(`Run '${run.runId}' references missing playbook '${run.playbookId}'.`);
  return { run, playbook };
}

function getAvailableSkills(pi: ExtensionAPI): ReadonlySet<string> {
  const skills = pi.getCommands()
    .filter((command) => command.source === "skill")
    .map((command) => normalizeSkillCommandName(command.name));
  return new Set(skills);
}

function renderWidget(ui: UiLike | undefined, playbook: LoadedPlaybook, run: PlaybookRunState): void {
  ui?.setWidget(WIDGET_ID, renderStepCard(playbook, run), { placement: "belowEditor" });
}

function clearWidget(ui: UiLike | undefined): void {
  ui?.setWidget(WIDGET_ID, undefined);
}

function notify(ui: UiLike | undefined, message: string, level: "info" | "warning" | "error"): void {
  ui?.notify(message, level);
}

function usage(): string {
  return [
    "Usage:",
    "/playbook list",
    "/playbook start <playbook-id> [--run <name>]",
    "/playbook resume <run-id>",
    "/playbook status [run-id]",
    "/playbook done",
    "/playbook choose <outcome>",
  ].join("\n");
}

function parseArgs(args: string): string[] {
  const matches = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((arg) => arg.replace(/^(["'])(.*)\1$/, "$2"));
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

interface UiLike {
  notify(message: string, level: "info" | "warning" | "error"): void;
  setWidget(id: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
}
