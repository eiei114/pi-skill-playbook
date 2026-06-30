import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { lastAssistantText, parseOutcomeMarker, parseSkillInvocation, planCompletion, renderPlaybookPrompt } from "../src/auto-advance.js";
import { formatCompletedRunLine, listCompletedRunSummaries, renderCompletedRunDetail } from "../src/history.js";
import { formatRunDiff, loadRecentRunDiffs } from "../src/run-diff.js";
import { clearActiveRun, createRunId, listRunIds, loadActiveRunId, loadRun, saveRun, setActiveRun } from "../src/state.js";
import { findPlaybook, loadPlaybooks } from "../src/playbooks.js";
import { getGitignoreAdvisory } from "../src/gitignore.js";
import { renderValidationErrors } from "../src/render.js";
import { buildRunStatusPresentation, notifyLevelForValidation } from "../src/status.js";
import { normalizeSkillCommandName, validatePlaybook, validateUniquePlaybookIds } from "../src/validation.js";
import { handleRecordCommand, RECORD_COMMANDS, recordUsage } from "../src/record-handlers.js";
import type { LoadedPlaybook, PlaybookRunState } from "../src/types.js";

const WIDGET_ID = "pi-skill-playbook";
let gitignoreAdvisoryShownThisSession = false;

export function resetGitignoreAdvisorySessionForTest(): void {
  gitignoreAdvisoryShownThisSession = false;
}

async function notifyWithGitignoreAdvisory(
  cwd: string,
  ui: UiLike | undefined,
  lines: string[],
  defaultLevel: "info" | "warning" = "info",
): Promise<void> {
  if (gitignoreAdvisoryShownThisSession) {
    notify(ui, lines.join("\n"), defaultLevel);
    return;
  }

  const advisory = await getGitignoreAdvisory(cwd);
  if (!advisory) {
    notify(ui, lines.join("\n"), defaultLevel);
    return;
  }

  gitignoreAdvisoryShownThisSession = true;
  notify(ui, [...lines, "", advisory].join("\n"), "warning");
}

const COMMANDS = [
  ["list", "list available playbooks"],
  ["start", "start a playbook run"],
  ["resume", "resume an active playbook run"],
  ["status", "show playbook run status"],
  ["done", "complete the current step"],
  ["choose", "choose a step outcome"],
  ["cancel", "cancel an active playbook run"],
  ["history", "browse completed playbook runs"],
  ["rundiff", "compare recent completed playbook runs"],
] as const;

type CommandContext = {
  cwd: string;
  hasUI: boolean;
  ui?: UiLike;
};

type SelectOption<T> = {
  label: string;
  value: T;
};

export default function piSkillPlaybook(pi: ExtensionAPI) {
  let pendingSkillInvocation: string | undefined;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const activeRunId = await loadActiveRunId(ctx.cwd);
    if (!activeRunId) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }
    const run = await loadRun(ctx.cwd, activeRunId);
    if (!run || run.status !== "active") {
      await clearActiveRun(ctx.cwd);
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
    const presentation = await buildRunStatusPresentation(ctx.cwd, playbook, run, getAvailableSkills(pi));
    ctx.ui.setWidget(WIDGET_ID, presentation.lines, { placement: "belowEditor" });
  });

  pi.on("input", (event) => {
    if (event.source === "extension") return { action: "continue" };
    pendingSkillInvocation = parseSkillInvocation(event.text);
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const active = await loadActiveIfAvailable(ctx.cwd);
    if (!active) return;
    const prompt = renderPlaybookPrompt(active.playbook, active.run);
    if (!prompt) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${prompt}` };
  });

  pi.on("agent_end", async (event, ctx) => {
    try {
      await processAgentCompletion(pi, ctx.cwd, pendingSkillInvocation, lastAssistantText(event.messages), ctx.hasUI ? ctx.ui : undefined);
    } finally {
      pendingSkillInvocation = undefined;
    }
  });

  for (const [command, description] of COMMANDS) {
    pi.registerCommand(`playbook:${command}`, {
      description: `Playbook: ${description}.`,
      handler: async (_args, ctx) => {
        try {
          await handlePlaybookCommand(pi, command, ctx);
        } catch (error) {
          notify(ctx.hasUI ? ctx.ui : undefined, error instanceof Error ? error.message : String(error), "error");
        }
      },
    });
  }

  for (const [command, description] of RECORD_COMMANDS) {
    pi.registerCommand(`playbook:${command}`, {
      description: `Playbook: ${description}.`,
      handler: async (args, ctx) => {
        try {
          await handleRecordCommand(pi, command, args, ctx);
        } catch (error) {
          notify(ctx.hasUI ? ctx.ui : undefined, error instanceof Error ? error.message : String(error), "error");
        }
      },
    });
  }

  pi.registerCommand("playbook:record", {
    description: "Playbook: record an explicit skill flow into a draft.",
    handler: async (args, ctx) => {
      try {
        await handleRecordCommand(pi, "record", args, ctx);
      } catch (error) {
        notify(ctx.hasUI ? ctx.ui : undefined, error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}

export async function handlePlaybookCommand(
  pi: ExtensionAPI,
  command: string,
  ctx: CommandContext,
): Promise<void> {
  const ui = ctx.hasUI ? ctx.ui : undefined;

  switch (command) {
    case "list":
      await listPlaybooks(pi, ctx.cwd, ui);
      return;
    case "start":
      await startPlaybook(pi, ctx.cwd, ui);
      return;
    case "resume":
      await resumeRun(pi, ctx.cwd, ui);
      return;
    case "status":
      await showStatus(pi, ctx.cwd, ui);
      return;
    case "done":
      await completeCurrentStep(pi, ctx.cwd, ui);
      return;
    case "choose":
      await chooseOutcome(pi, ctx.cwd, ui);
      return;
    case "history":
      await showHistory(ctx.cwd, ui);
      return;
    case "rundiff":
      await showRunDiff(ctx.cwd, ui);
      return;
    case "cancel":
    case "stop":
    case "abort":
      await cancelRun(ctx.cwd, ui);
      return;
    case "import-web":
      notify(ui, `/playbook:${command} is deferred after the Core 6 MVP scaffold.`, "warning");
      return;
    default:
      notify(ui, usage(), "error");
  }
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

async function startPlaybook(pi: ExtensionAPI, cwd: string, ui: UiLike | undefined): Promise<void> {
  const playbook = await pickPlaybook(pi, cwd, ui);
  if (!playbook) return;
  await createAndActivateRun(pi, cwd, playbook, undefined, ui);
}

async function createAndActivateRun(pi: ExtensionAPI, cwd: string, playbook: LoadedPlaybook, runName: string | undefined, ui: UiLike | undefined): Promise<void> {
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
  await renderWidget(pi, cwd, ui, playbook, run);
  await notifyWithGitignoreAdvisory(cwd, ui, [`Started ${run.runId}.`]);
}

async function resumeRun(pi: ExtensionAPI, cwd: string, ui: UiLike | undefined): Promise<void> {
  const run = await pickActiveRun(cwd, ui, "Resume which playbook run?");
  if (!run) return;

  const playbook = await findPlaybook(cwd, run.playbookId);
  if (!playbook) throw new Error(`Run '${run.runId}' references missing playbook '${run.playbookId}'.`);
  await setActiveRun(cwd, run.runId);
  await renderWidget(pi, cwd, ui, playbook, run);
  await notifyWithGitignoreAdvisory(cwd, ui, [`Resumed ${run.runId}.`]);
}

async function cancelRun(cwd: string, ui: UiLike | undefined): Promise<void> {
  const run = await pickRunToCancel(cwd, ui);
  if (!run) return;

  if (run.status !== "active") {
    if ((await loadActiveRunId(cwd)) === run.runId) await clearActiveRun(cwd);
    clearWidget(ui);
    notify(ui, `Run '${run.runId}' is already ${run.status}.`, "info");
    return;
  }

  const now = new Date().toISOString();
  run.status = "cancelled";
  run.updatedAt = now;
  run.history.push({ at: now, step: run.currentStep, outcome: "cancelled", to: "cancelled" });
  await saveRun(cwd, run);
  if ((await loadActiveRunId(cwd)) === run.runId) await clearActiveRun(cwd);
  clearWidget(ui);
  notify(ui, `Cancelled playbook run ${run.runId}.`, "info");
}

async function showStatus(pi: ExtensionAPI, cwd: string, ui: UiLike | undefined): Promise<void> {
  const runId = await loadActiveRunId(cwd);
  if (!runId) {
    notify(ui, "No active playbook run. Browse finished runs with /playbook:history.", "info");
    clearWidget(ui);
    return;
  }
  const run = await loadRun(cwd, runId);
  if (!run) throw new Error(`Run '${runId}' not found.`);
  if (run.status !== "active") {
    notify(ui, `Run '${run.runId}' is ${run.status}.`, "info");
    clearWidget(ui);
    return;
  }
  const playbook = await findPlaybook(cwd, run.playbookId);
  if (!playbook) throw new Error(`Run '${runId}' references missing playbook '${run.playbookId}'.`);
  const presentation = await buildRunStatusPresentation(cwd, playbook, run, getAvailableSkills(pi));
  ui?.setWidget(WIDGET_ID, presentation.lines, { placement: "belowEditor" });
  const notifyLevel = notifyLevelForValidation(presentation.level, false);
  if (notifyLevel === "error") {
    notify(ui, presentation.lines.join("\n"), "error");
    return;
  }
  await notifyWithGitignoreAdvisory(cwd, ui, presentation.lines, notifyLevel);
}

async function showRunDiff(cwd: string, ui: UiLike | undefined): Promise<void> {
  const diffs = await loadRecentRunDiffs(cwd);
  if (diffs.length === 0) {
    notify(
      ui,
      [
        "Not enough completed runs to compare.",
        "You need at least 2 completed runs to see a run diff.",
        "Complete runs with /playbook:done; browse finished runs with /playbook:history.",
      ].join("\n"),
      "info",
    );
    return;
  }

  if (hasSelectionUI(ui) && diffs.length > 1) {
    const selected = await selectByLabel(
      ui,
      "Compare which run pair?",
      diffs.map((diff) => ({
        label: `${diff.newer.runId} vs ${diff.older.runId}`,
        value: diff,
      })),
    );
    if (!selected) return;
    notify(ui, formatRunDiff(selected).join("\n"), "info");
    return;
  }

  notify(ui, formatRunDiff(diffs[0]).join("\n"), "info");
}

async function showHistory(cwd: string, ui: UiLike | undefined): Promise<void> {
  const summaries = await listCompletedRunSummaries(cwd);
  if (summaries.length === 0) {
    notify(
      ui,
      [
        "No completed playbook runs.",
        "Active runs resume with /playbook:resume; finished runs stay in .pi/playbook-runs/ as read-only history.",
      ].join("\n"),
      "info",
    );
    return;
  }

  if (hasSelectionUI(ui) && summaries.length > 1) {
    const selected = await selectByLabel(
      ui,
      "Browse which completed run?",
      summaries.map((summary) => ({ label: formatCompletedRunLine(summary), value: summary })),
    );
    if (!selected) return;
    notify(ui, renderCompletedRunDetail(selected).join("\n"), "info");
    return;
  }

  const lines = [
    `Completed playbook runs (${summaries.length}):`,
    ...summaries.map((summary) => formatCompletedRunLine(summary)),
  ];
  if (summaries.length === 1) {
    lines.push("", ...renderCompletedRunDetail(summaries[0]));
  }
  notify(ui, lines.join("\n"), "info");
}

async function completeCurrentStep(pi: ExtensionAPI, cwd: string, ui: UiLike | undefined): Promise<void> {
  const { run, playbook } = await loadActive(cwd);
  const step = playbook.definition.steps[run.currentStep];
  if (!step) throw new Error(`Current step '${run.currentStep}' is missing.`);

  if (step.transitions.length === 0) {
    await completeRun(pi, cwd, playbook, run, "complete", "complete", ui);
    return;
  }
  if (step.transitions.length > 1) {
    notify(ui, `Step attested. Choose outcome: ${step.transitions.map((t) => t.outcome).join(", ")}`, "info");
    await renderWidget(pi, cwd, ui, playbook, run);
    return;
  }
  await advanceRun(pi, cwd, playbook, run, step.transitions[0].outcome, ui);
}

async function chooseOutcome(pi: ExtensionAPI, cwd: string, ui: UiLike | undefined): Promise<void> {
  const { run, playbook } = await loadActive(cwd);
  const selected = await pickOutcome(playbook, run, ui);
  if (!selected) return;
  await advanceRun(pi, cwd, playbook, run, selected.outcome, ui);
}

async function pickPlaybook(pi: ExtensionAPI, cwd: string, ui: UiLike | undefined): Promise<LoadedPlaybook | undefined> {
  if (!hasSelectionUI(ui)) {
    notify(ui, "Interactive playbook selection requires the Pi TUI. Run /playbook:start from the command palette.", "error");
    return undefined;
  }

  const playbooks = await loadPlaybooks(cwd);
  if (playbooks.length === 0) {
    notify(ui, "No playbooks found. Create .pi/playbooks/*.yml or copy samples/feature-development.yml into .pi/playbooks/.", "info");
    return undefined;
  }

  const availableSkills = getAvailableSkills(pi);
  const duplicateErrors = duplicateIdErrors(playbooks);
  const candidates = playbooks.map((playbook) => {
    const validation = validatePlaybook(playbook, availableSkills, { requireSkills: true });
    const errors = [...validation.errors, ...(duplicateErrors.get(playbook) ?? [])];
    return { playbook, errors, valid: errors.length === 0 };
  });

  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (!candidate.valid) {
      notify(ui, `Playbook validation failed:\n${renderValidationErrors(candidate.errors)}`, "error");
      return undefined;
    }
    return candidate.playbook;
  }

  const options = candidates.map((candidate) => ({
    label: playbookSelectionLabel(candidate.playbook, candidate.errors),
    value: candidate,
  }));
  const selected = await selectByLabel(ui, "Start which playbook?", options);
  if (!selected) return undefined;
  if (!selected.valid) {
    notify(ui, `Playbook validation failed:\n${renderValidationErrors(selected.errors)}`, "error");
    return undefined;
  }
  return selected.playbook;
}

function playbookSelectionLabel(playbook: LoadedPlaybook, errors: string[]): string {
  const marker = errors.length === 0 ? "ok" : "invalid";
  const suffix = errors.length === 0 ? "" : ` — ${errors.join("; ")}`;
  return `${playbook.definition.id} — ${playbook.definition.name} (${marker})${suffix}`;
}

function duplicateIdErrors(playbooks: LoadedPlaybook[]): Map<LoadedPlaybook, string[]> {
  const byId = new Map<string, LoadedPlaybook[]>();
  for (const playbook of playbooks) {
    const id = playbook.definition.id;
    if (!id) continue;
    byId.set(id, [...(byId.get(id) ?? []), playbook]);
  }

  const result = new Map<LoadedPlaybook, string[]>();
  for (const [id, matches] of byId) {
    if (matches.length < 2) continue;
    const paths = matches.map((playbook) => playbook.path).join(", ");
    for (const playbook of matches) result.set(playbook, [`duplicate playbook id '${id}' in ${paths}`]);
  }
  return result;
}

async function pickActiveRun(cwd: string, ui: UiLike | undefined, title: string): Promise<PlaybookRunState | undefined> {
  if (!hasSelectionUI(ui)) {
    notify(ui, "Interactive run selection requires the Pi TUI. Run /playbook:resume from the command palette.", "error");
    return undefined;
  }

  const runs = await getActiveRuns(cwd);
  if (runs.length === 0) {
    clearWidget(ui);
    notify(ui, "No active playbook runs. Start one with /playbook:start.", "info");
    return undefined;
  }

  return selectByLabel(ui, title, runs.map((run) => ({ label: activeRunLabel(run), value: run })));
}

async function pickRunToCancel(cwd: string, ui: UiLike | undefined): Promise<PlaybookRunState | undefined> {
  if (!hasConfirmUI(ui)) {
    notify(ui, "Interactive cancellation requires the Pi TUI. Run /playbook:cancel from the command palette.", "error");
    return undefined;
  }

  const runs = await getActiveRuns(cwd);
  if (runs.length === 0) {
    clearWidget(ui);
    notify(ui, "No active playbook runs to cancel.", "info");
    return undefined;
  }

  const run = runs.length === 1
    ? runs[0]
    : await selectByLabel(ui, "Cancel which playbook run?", runs.map((candidate) => ({ label: activeRunLabel(candidate), value: candidate })));
  if (!run) return undefined;

  const confirmed = await ui.confirm("Cancel playbook run?", `${run.runId} (${run.playbookId}) will be marked cancelled.`);
  if (!confirmed) {
    notify(ui, "Playbook cancellation skipped.", "info");
    return undefined;
  }
  return run;
}

function activeRunLabel(run: PlaybookRunState): string {
  return `${run.runId} — ${run.playbookId} (updated ${run.updatedAt})`;
}

async function pickOutcome(playbook: LoadedPlaybook, run: PlaybookRunState, ui: UiLike | undefined) {
  if (!hasSelectionUI(ui)) {
    notify(ui, "Interactive outcome selection requires the Pi TUI. Run /playbook:choose from the command palette.", "error");
    return undefined;
  }

  const step = playbook.definition.steps[run.currentStep];
  if (!step) throw new Error(`Current step '${run.currentStep}' is missing.`);
  if (step.transitions.length === 0) {
    notify(ui, "Current step has no branch outcomes. Run /playbook:done to complete it.", "info");
    return undefined;
  }

  return selectByLabel(
    ui,
    `Choose outcome for ${run.currentStep}`,
    step.transitions.map((transition) => ({ label: `${transition.outcome} → ${transition.to}`, value: transition })),
  );
}

async function selectByLabel<T>(
  ui: { select(title: string, options: string[]): Promise<string | undefined> },
  title: string,
  options: SelectOption<T>[],
): Promise<T | undefined> {
  const selected = await ui.select(title, options.map((option) => option.label));
  return options.find((option) => option.label === selected)?.value;
}

function hasSelectionUI(ui: UiLike | undefined): ui is UiLike & { select: NonNullable<UiLike["select"]> } {
  return typeof ui?.select === "function";
}

function hasConfirmUI(
  ui: UiLike | undefined,
): ui is UiLike & { select: NonNullable<UiLike["select"]>; confirm: NonNullable<UiLike["confirm"]> } {
  return hasSelectionUI(ui) && typeof ui.confirm === "function";
}

async function advanceRun(pi: ExtensionAPI, cwd: string, playbook: LoadedPlaybook, run: PlaybookRunState, outcome: string, ui: UiLike | undefined): Promise<void> {
  const step = playbook.definition.steps[run.currentStep];
  if (!step) throw new Error(`Current step '${run.currentStep}' is missing.`);
  const transition = step.transitions.find((candidate) => candidate.outcome === outcome);
  if (!transition) {
    throw new Error(`Outcome '${outcome}' is not valid for step '${run.currentStep}'. Valid: ${step.transitions.map((t) => t.outcome).join(", ")}`);
  }
  await completeRun(pi, cwd, playbook, run, transition.outcome, transition.to, ui);
}

async function completeRun(pi: ExtensionAPI, cwd: string, playbook: LoadedPlaybook, run: PlaybookRunState, outcome: string, to: string, ui: UiLike | undefined): Promise<void> {
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
  await renderWidget(pi, cwd, ui, playbook, run);
  notify(ui, `Advanced to '${to}'.`, "info");
}

async function processAgentCompletion(pi: ExtensionAPI, cwd: string, invokedSkill: string | undefined, assistantText: string, ui: UiLike | undefined): Promise<void> {
  const active = await loadActiveIfAvailable(cwd);
  if (!active) return;

  const marker = parseOutcomeMarker(assistantText);
  const plan = planCompletion(active.playbook, active.run, invokedSkill, marker);
  if (!plan) return;

  if (plan.kind === "auto") {
    await completeRun(pi, cwd, active.playbook, active.run, plan.outcome ?? "complete", plan.to ?? "complete", ui);
    return;
  }

  if (plan.kind === "suggest") {
    await renderWidget(pi, cwd, ui, active.playbook, active.run, plan.message);
    notify(ui, plan.message, "info");
    return;
  }

  notify(ui, plan.message, plan.kind === "warning" ? "warning" : "info");
}

const AUTO_ADVANCE_TEST_PI = {
  getCommands: () => [
    { source: "skill", name: "skill:grill-with-docs" },
    { source: "skill", name: "skill:review" },
  ],
} as unknown as ExtensionAPI;

export async function processAgentCompletionForTest(
  cwd: string,
  invokedSkill: string | undefined,
  assistantText: string,
  ui: UiLike | undefined,
): Promise<void> {
  return processAgentCompletion(AUTO_ADVANCE_TEST_PI, cwd, invokedSkill, assistantText, ui);
}

async function loadActiveIfAvailable(cwd: string): Promise<{ run: PlaybookRunState; playbook: LoadedPlaybook } | undefined> {
  const runId = await loadActiveRunId(cwd);
  if (!runId) return undefined;
  const run = await loadRun(cwd, runId);
  if (!run || run.status !== "active") return undefined;
  const playbook = await findPlaybook(cwd, run.playbookId);
  if (!playbook) return undefined;
  return { run, playbook };
}

async function loadActive(cwd: string): Promise<{ run: PlaybookRunState; playbook: LoadedPlaybook }> {
  const runId = await loadActiveRunId(cwd);
  if (!runId) throw new Error("No active playbook run.");
  const run = await loadRun(cwd, runId);
  if (!run) throw new Error(`Active run '${runId}' not found.`);
  if (run.status !== "active") throw new Error(`Active run '${runId}' is ${run.status}.`);
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

async function renderWidget(pi: ExtensionAPI, cwd: string, ui: UiLike | undefined, playbook: LoadedPlaybook, run: PlaybookRunState, notice?: string): Promise<void> {
  const presentation = await buildRunStatusPresentation(cwd, playbook, run, getAvailableSkills(pi));
  const lines = notice ? [...presentation.lines, "", notice] : presentation.lines;
  ui?.setWidget(WIDGET_ID, lines, { placement: "belowEditor" });
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
    "/playbook:list",
    "/playbook:start",
    "/playbook:resume",
    "/playbook:status",
    "/playbook:done",
    "/playbook:choose",
    "/playbook:cancel",
    "/playbook:history",
    "",
    recordUsage(),
  ].join("\n");
}

async function getActiveRuns(cwd: string): Promise<PlaybookRunState[]> {
  const ids = await listRunIds(cwd);
  const runs = (await Promise.all(ids.map((id) => loadRun(cwd, id)))).filter((run): run is PlaybookRunState => Boolean(run));
  return runs.filter((run) => run.status === "active").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

interface UiLike {
  notify(message: string, level: "info" | "warning" | "error"): void;
  select?(title: string, options: string[]): Promise<string | undefined>;
  confirm?(title: string, message: string): Promise<boolean>;
  setWidget(id: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
}
