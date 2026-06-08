import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { lastAssistantText, parseOutcomeMarker, parseSkillInvocation, planCompletion, renderPlaybookPrompt } from "../src/auto-advance.js";
import { clearActiveRun, createRunId, listRunIds, loadActiveRunId, loadRun, saveRun, setActiveRun } from "../src/state.js";
import { findPlaybook, loadPlaybooks } from "../src/playbooks.js";
import { getGitignoreAdvisory } from "../src/gitignore.js";
import { renderStepCard, renderValidationErrors } from "../src/render.js";
import { normalizeSkillCommandName, validatePlaybook, validateUniquePlaybookIds } from "../src/validation.js";
import type { LoadedPlaybook, PlaybookRunState } from "../src/types.js";

const WIDGET_ID = "pi-skill-playbook";

const COMMANDS = [
  ["list", "list available playbooks"],
  ["start", "start a playbook run"],
  ["resume", "resume an active playbook run"],
  ["status", "show playbook run status"],
  ["done", "complete the current step"],
  ["choose", "choose a step outcome"],
  ["cancel", "cancel an active playbook run"],
] as const;

const COLON_COMMAND_ALIASES = COMMANDS.map(([command, description]) => ({
  name: `playbook:${command}`,
  command,
  description,
}));

const COLON_COMPLETION_COMMANDS = new Set(["start", "resume", "status", "cancel", "choose"]);

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
  let completionCwd = process.cwd();
  let pendingSkillInvocation: string | undefined;

  pi.on("session_start", async (_event, ctx) => {
    completionCwd = ctx.cwd;
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
    ctx.ui.setWidget(WIDGET_ID, renderStepCard(playbook, run), { placement: "belowEditor" });
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
      await processAgentCompletion(ctx.cwd, pendingSkillInvocation, lastAssistantText(event.messages), ctx.hasUI ? ctx.ui : undefined);
    } finally {
      pendingSkillInvocation = undefined;
    }
  });

  pi.registerCommand("playbook", {
    description: "Guide Agent Skill workflows with project-local playbooks",
    getArgumentCompletions: (prefix) => getPlaybookArgumentCompletions(completionCwd, prefix),
    handler: async (args, ctx) => {
      const parsed = parseArgs(args);
      const command = parsed.shift() ?? "status";
      try {
        await handlePlaybookCommand(pi, command, parsed, ctx);
      } catch (error) {
        notify(ctx.hasUI ? ctx.ui : undefined, error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  for (const alias of COLON_COMMAND_ALIASES) {
    pi.registerCommand(alias.name, {
      description: `Playbook: ${alias.description}. Alias for /playbook ${alias.command}.`,
      ...(COLON_COMPLETION_COMMANDS.has(alias.command)
        ? { getArgumentCompletions: (prefix) => getPlaybookColonArgumentCompletions(completionCwd, alias.command, prefix) }
        : {}),
      handler: async (args, ctx) => {
        try {
          await handlePlaybookCommand(pi, alias.command, parseArgs(args), ctx);
        } catch (error) {
          notify(ctx.hasUI ? ctx.ui : undefined, error instanceof Error ? error.message : String(error), "error");
        }
      },
    });
  }
}

export async function handlePlaybookCommand(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  ctx: CommandContext,
): Promise<void> {
  const ui = ctx.hasUI ? ctx.ui : undefined;

  switch (command) {
    case "list":
      await listPlaybooks(pi, ctx.cwd, ui);
      return;
    case "start":
      await startPlaybook(pi, ctx.cwd, args, ui);
      return;
    case "resume":
      await resumeRun(ctx.cwd, args, ui);
      return;
    case "status":
      await showStatus(ctx.cwd, args[0], ui);
      return;
    case "done":
      await completeCurrentStep(ctx.cwd, ui);
      return;
    case "choose":
      await chooseOutcome(ctx.cwd, args[0], ui);
      return;
    case "cancel":
    case "stop":
    case "abort":
      await cancelRun(ctx.cwd, args[0], ui);
      return;
    case "import-web":
    case "record":
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

async function startPlaybook(pi: ExtensionAPI, cwd: string, args: string[], ui: UiLike | undefined): Promise<void> {
  const playbookId = args[0];
  if (!playbookId) {
    const playbook = await pickPlaybook(pi, cwd, ui);
    if (!playbook) return;
    await createAndActivateRun(cwd, playbook, undefined, ui);
    return;
  }

  const playbook = await findPlaybook(cwd, playbookId);
  if (!playbook) throw new Error(`Playbook '${playbookId}' not found in .pi/playbooks/.`);

  const validation = validatePlaybook(playbook, getAvailableSkills(pi), { requireSkills: true });
  if (!validation.valid) {
    throw new Error(`Playbook validation failed:\n${renderValidationErrors(validation.errors)}`);
  }

  const runName = readFlagValue(args.slice(1), "--run");
  await createAndActivateRun(cwd, playbook, runName, ui);
}

async function createAndActivateRun(cwd: string, playbook: LoadedPlaybook, runName: string | undefined, ui: UiLike | undefined): Promise<void> {
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
  if (!runId) {
    const run = await pickActiveRun(cwd, ui, "Resume which playbook run?");
    if (!run) return;
    await resumeRun(cwd, [run.runId], ui);
    return;
  }
  const run = await loadRun(cwd, runId);
  if (!run) throw new Error(`Run '${runId}' not found.`);
  if (run.status !== "active") throw new Error(`Run '${runId}' is ${run.status}.`);
  const playbook = await findPlaybook(cwd, run.playbookId);
  if (!playbook) throw new Error(`Run '${runId}' references missing playbook '${run.playbookId}'.`);
  await setActiveRun(cwd, run.runId);
  renderWidget(ui, playbook, run);
  notify(ui, `Resumed ${run.runId}.`, "info");
}

async function cancelRun(cwd: string, explicitRunId: string | undefined, ui: UiLike | undefined): Promise<void> {
  let runId = explicitRunId;
  if (!runId) {
    const run = await pickRunToCancel(cwd, ui);
    if (!run) return;
    runId = run.runId;
  }
  const run = await loadRun(cwd, runId);
  if (!run) throw new Error(`Run '${runId}' not found.`);

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

async function showStatus(cwd: string, explicitRunId: string | undefined, ui: UiLike | undefined): Promise<void> {
  const runId = explicitRunId ?? (await loadActiveRunId(cwd));
  if (!runId) {
    notify(ui, "No active playbook run.", "info");
    clearWidget(ui);
    return;
  }
  const run = await loadRun(cwd, runId);
  if (!run) throw new Error(`Run '${runId}' not found.`);
  if (run.status !== "active") {
    notify(ui, `Run '${run.runId}' is ${run.status}.`, "info");
    if (!explicitRunId) clearWidget(ui);
    return;
  }
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
  const { run, playbook } = await loadActive(cwd);
  if (!outcome) {
    const selected = await pickOutcome(playbook, run, ui);
    if (!selected) return;
    outcome = selected.outcome;
  }
  await advanceRun(cwd, playbook, run, outcome, ui);
}

async function pickPlaybook(pi: ExtensionAPI, cwd: string, ui: UiLike | undefined): Promise<LoadedPlaybook | undefined> {
  if (!hasSelectionUI(ui)) {
    notify(ui, "Interactive playbook selection requires the Pi TUI. For scripts, use /playbook:start <playbook-id> [--run <name>].", "error");
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
    notify(ui, "Interactive run selection requires the Pi TUI. For scripts, pass the run id explicitly.", "error");
    return undefined;
  }

  const runs = await getRunCompletionCandidates(cwd, true);
  if (runs.length === 0) {
    clearWidget(ui);
    notify(ui, "No active playbook runs. Start one with /playbook:start.", "info");
    return undefined;
  }

  return selectByLabel(ui, title, runs.map((run) => ({ label: activeRunLabel(run), value: run })));
}

async function pickRunToCancel(cwd: string, ui: UiLike | undefined): Promise<PlaybookRunState | undefined> {
  if (!hasConfirmUI(ui)) {
    notify(ui, "Interactive cancellation requires the Pi TUI. For scripts, use /playbook:cancel <run-id>.", "error");
    return undefined;
  }

  const runs = await getRunCompletionCandidates(cwd, true);
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
    notify(ui, "Interactive outcome selection requires the Pi TUI. For scripts, use /playbook:choose <outcome>.", "error");
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

async function processAgentCompletion(cwd: string, invokedSkill: string | undefined, assistantText: string, ui: UiLike | undefined): Promise<void> {
  const active = await loadActiveIfAvailable(cwd);
  if (!active) return;

  const marker = parseOutcomeMarker(assistantText);
  const plan = planCompletion(active.playbook, active.run, invokedSkill, marker);
  if (!plan) return;

  if (plan.kind === "auto") {
    await completeRun(cwd, active.playbook, active.run, plan.outcome ?? "complete", plan.to ?? "complete", ui);
    return;
  }

  if (plan.kind === "suggest") {
    renderWidget(ui, active.playbook, active.run, plan.message);
    notify(ui, plan.message, "info");
    return;
  }

  notify(ui, plan.message, plan.kind === "warning" ? "warning" : "info");
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

function renderWidget(ui: UiLike | undefined, playbook: LoadedPlaybook, run: PlaybookRunState, notice?: string): void {
  const lines = renderStepCard(playbook, run);
  ui?.setWidget(WIDGET_ID, notice ? [...lines, "", notice] : lines, { placement: "belowEditor" });
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
    "/playbook:status [run-id]",
    "/playbook:done",
    "/playbook:choose",
    "/playbook:cancel",
    "Legacy explicit args remain available for scripts: start <playbook-id> [--run <name>], resume <run-id>, choose <outcome>, cancel <run-id>.",
  ].join("\n");
}

type CompletionItem = { value: string; label: string; description?: string };

export async function getPlaybookArgumentCompletions(cwd: string, prefix: string): Promise<CompletionItem[] | null> {
  try {
    return await getPlaybookArgumentCompletionsUnsafe(cwd, prefix);
  } catch {
    return null;
  }
}

export async function getPlaybookColonArgumentCompletions(
  cwd: string,
  command: string,
  prefix: string,
): Promise<CompletionItem[] | null> {
  try {
    const normalizedPrefix = prefix.trimStart();
    const legacyPrefix = normalizedPrefix ? `${command} ${normalizedPrefix}` : command;
    const items = await getPlaybookArgumentCompletionsUnsafe(cwd, legacyPrefix);
    if (!items) return null;
    const legacyToken = `${command} `;
    return items.map((item) => ({
      ...item,
      value: item.value.startsWith(legacyToken) ? item.value.slice(legacyToken.length) : item.value,
    }));
  } catch {
    return null;
  }
}

async function getPlaybookArgumentCompletionsUnsafe(cwd: string, prefix: string): Promise<CompletionItem[] | null> {
  const parsed = parseCompletionPrefix(prefix);
  const command = parsed.command;
  if (!command) {
    return completeCommands(parsed.currentToken);
  }

  if (parsed.completedTokens.length === 0) {
    return completeCommands(parsed.currentToken);
  }

  switch (command) {
    case "start":
      return completeStartArguments(cwd, parsed);
    case "resume":
      return completeRunArgument(cwd, parsed, command, { activeOnly: true });
    case "status":
      return completeRunArgument(cwd, parsed, command, { activeOnly: false, optional: true });
    case "cancel":
    case "stop":
    case "abort":
      return completeRunArgument(cwd, parsed, command, { activeOnly: true, optional: true });
    case "choose":
      return completeOutcomeArgument(cwd, parsed);
    default:
      return null;
  }
}

function completeCommands(token: string): CompletionItem[] | null {
  const commands = ["list", "start", "resume", "status", "done", "choose", "cancel"];
  return toCompletionItems(commands, token, (command) => command, (command) => command);
}

async function completeStartArguments(cwd: string, parsed: CompletionPrefix): Promise<CompletionItem[] | null> {
  const args = parsed.completedTokens.slice(1);
  if (args.length === 0) {
    const playbooks = await loadPlaybooks(cwd);
    return toCompletionItems(
      playbooks,
      parsed.currentToken,
      (playbook) => `start ${playbook.definition.id}`,
      (playbook) => playbook.definition.id,
      (playbook) => playbook.definition.name,
    );
  }

  if (args.length >= 1 && !args.includes("--run")) {
    return toCompletionItems(["--run"], parsed.currentToken, (flag) => `start ${args.join(" ")} ${flag} `, (flag) => flag);
  }
  return null;
}

async function completeRunArgument(
  cwd: string,
  parsed: CompletionPrefix,
  command: string,
  options: { activeOnly: boolean; optional?: boolean },
): Promise<CompletionItem[] | null> {
  const args = parsed.completedTokens.slice(1);
  if (args.length > 0 || (options.optional && parsed.currentToken === "" && !parsed.trailingWhitespace)) return null;
  const runs = await getRunCompletionCandidates(cwd, options.activeOnly);
  return toCompletionItems(
    runs,
    parsed.currentToken,
    (run) => `${command} ${run.runId}`,
    (run) => run.runId,
    (run) => `${run.playbookId} (${run.status})`,
  );
}

async function completeOutcomeArgument(cwd: string, parsed: CompletionPrefix): Promise<CompletionItem[] | null> {
  const args = parsed.completedTokens.slice(1);
  if (args.length > 0) return null;
  const { run, playbook } = await loadActive(cwd);
  const step = playbook.definition.steps[run.currentStep];
  if (!step) return null;
  return toCompletionItems(
    step.transitions,
    parsed.currentToken,
    (transition) => `choose ${transition.outcome}`,
    (transition) => transition.outcome,
    (transition) => `to ${transition.to}`,
  );
}

async function getRunCompletionCandidates(cwd: string, activeOnly: boolean): Promise<PlaybookRunState[]> {
  const ids = await listRunIds(cwd);
  const runs = (await Promise.all(ids.map((id) => loadRun(cwd, id)))).filter((run): run is PlaybookRunState => Boolean(run));
  const filtered = activeOnly ? runs.filter((run) => run.status === "active") : runs;
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function toCompletionItems<T>(
  values: T[],
  token: string,
  valueFor: (item: T) => string,
  labelFor: (item: T) => string,
  descriptionFor?: (item: T) => string | undefined,
): CompletionItem[] | null {
  const normalizedToken = token.trim().toLowerCase();
  const items = values
    .filter((item) => matchesCompletion(labelFor(item), normalizedToken))
    .map((item) => {
      const description = descriptionFor?.(item);
      return { value: valueFor(item), label: labelFor(item), ...(description ? { description } : {}) };
    });
  return items.length > 0 ? items : null;
}

function matchesCompletion(value: string, token: string): boolean {
  if (token === "") return true;
  return value.toLowerCase().includes(token);
}

type CompletionPrefix = {
  completedTokens: string[];
  currentToken: string;
  command: string | undefined;
  trailingWhitespace: boolean;
};

function parseCompletionPrefix(prefix: string): CompletionPrefix {
  const trailingWhitespace = /\s$/.test(prefix);
  const tokens = parseArgs(prefix);
  const completedTokens = trailingWhitespace ? tokens : tokens.slice(0, -1);
  const currentToken = trailingWhitespace ? "" : tokens.at(-1) ?? "";
  return { completedTokens, currentToken, command: completedTokens[0] ?? (!trailingWhitespace && tokens.length > 1 ? tokens[0] : undefined), trailingWhitespace };
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
  select?(title: string, options: string[]): Promise<string | undefined>;
  confirm?(title: string, message: string): Promise<boolean>;
  setWidget(id: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
}
