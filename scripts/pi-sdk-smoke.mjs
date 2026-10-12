import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  behaviorAssertions,
  EXTENSION_LOAD_ERROR_PATTERN,
  SDK_VERSIONS,
  UNHANDLED_ERROR_PATTERN,
  VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, "docs/verification/pi-sdk-smoke.json");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifestVersions = Object.fromEntries(Object.entries(SDK_VERSIONS).map(([name, expected]) => {
  if (packageJson.devDependencies?.[name] !== expected) {
    throw new Error(`Expected exact devDependency ${name}=${expected}`);
  }
  const installed = readJson(resolve(root, "node_modules", name, "package.json")).version;
  if (installed !== expected) throw new Error(`Expected installed ${name}=${expected}; got ${installed}`);
  return [name, installed];
}));

const piPackagePath = resolve(root, "node_modules/@earendil-works/pi-coding-agent/package.json");
const piPackage = readJson(piPackagePath);
const piCli = resolve(root, "node_modules/@earendil-works/pi-coding-agent", piPackage.bin.pi);
const extension = resolve(root, "extensions/index.ts");
const offlineProviderExtension = resolve(root, "tests/fixtures/pi-sdk-offline-provider.mjs");
const maxOutputBytes = 1024 * 1024;
const probeTimeoutMs = 15_000;
const cleanupGraceMs = 1_000;
const agentEventTypes = new Set(["agent_start", "message_start", "tool_execution_start"]);

function isolatedEnvironment(rootDir, agentDir) {
  return {
    ...process.env,
    HOME: rootDir,
    USERPROFILE: rootDir,
    APPDATA: resolve(rootDir, "appdata"),
    LOCALAPPDATA: resolve(rootDir, "localappdata"),
    PI_CODING_AGENT_DIR: agentDir,
  };
}

function parseLine(line) {
  try {
    return { row: JSON.parse(line) };
  } catch (error) {
    return { error: `Non-JSON RPC output: ${line.slice(0, 200)} (${error.message})` };
  }
}

function runRpcProcess({ rootDir, agentDir, requiredCommand, promptMessage, expectedNotify, model }) {
  return new Promise((resolvePromise) => {
    const args = [piCli, "--offline", "--no-session", "--no-tools", "--no-extensions",
      "--no-context-files", "--no-prompt-templates", "--no-mcp", "-e", extension, "--mode", "rpc"];
    if (model) args.push("-e", offlineProviderExtension);
    let child;
    try {
      child = spawn(process.execPath, args, {
        cwd: rootDir,
        env: isolatedEnvironment(rootDir, agentDir),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolvePromise({ rows: [], stdout: "", stderr: "", exit_code: 1, process_exited: false, failure: error.message });
      return;
    }

    const rows = [];
    let stdout = "";
    let stderr = "";
    let pending = "";
    let outputBytes = 0;
    let failure = "";
    let endedInput = false;
    let settled = false;
    let cleanupTimer;
    const requestId = "playbook-smoke";
    let inventory;
    let prompt;
    let notification;
    let promptSent = false;

    const sendPrompt = () => {
      if (promptSent || !promptMessage) return;
      promptSent = true;
      child.stdin.write(JSON.stringify({ type: "prompt", id: requestId, message: promptMessage }) + "\n");
    };

    const endInput = () => {
      if (endedInput) return;
      endedInput = true;
      child.stdin.end();
    };

    const stop = (reason) => {
      if (failure) return;
      failure = reason;
      child.kill();
      cleanupTimer = setTimeout(() => {
        child.kill("SIGKILL");
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(null, null, false);
      }, cleanupGraceMs);
    };

    const maybeComplete = () => {
      if (!inventory) return;
      if (!promptMessage) {
        endInput();
        return;
      }
      if (prompt && expectedNotify && notification) endInput();
    };

    const handleRow = (row) => {
      rows.push(row);
      if (row.id === "inventory" && row.type === "response") {
        inventory = row;
        if (row.success !== true) {
          stop("Pi RPC get_commands failed");
          return;
        }
        const commands = row.data?.commands?.map((command) => command.name) ?? [];
        if (!commands.includes(requiredCommand)) {
          stop(`Pi extension did not register ${requiredCommand}; registered=${JSON.stringify(commands)}`);
          return;
        }
        if (model) child.stdin.write(JSON.stringify({
          type: "set_model", id: "model-selection", provider: model.provider, modelId: model.modelId,
        }) + "\n");
        else sendPrompt();
      }
      if (row.id === "model-selection" && row.type === "response") {
        if (row.success !== true) {
          stop(`Pi could not select the deterministic smoke model: ${JSON.stringify(row)}`);
          return;
        }
        sendPrompt();
      }
      if (promptMessage?.includes("/playbook:import-web") && row.type === "extension_ui_request" && row.method === "input") {
        // Empty input exercises the command's handled validation error without model inference or network access.
        child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: row.id, value: "" }) + "\n");
      }
      if (row.type === "extension_ui_request" && row.method === "confirm") {
        child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: row.id, confirmed: true }) + "\n");
      }
      if (row.id === requestId && row.type === "response") {
        prompt = row;
        if (row.success !== true || (row.data?.disposition !== undefined && row.data.disposition !== "handled")) {
          stop(`Pi rejected extension command: ${JSON.stringify(row)}`);
          return;
        }
      }
      if (expectedNotify && row.type === "extension_ui_request" && row.method === "notify"
        && row.notifyType === expectedNotify.level && typeof row.message === "string"
        && row.message.includes(expectedNotify.fragment)) {
        notification = row;
      }
      maybeComplete();
    };

    const consumeStdout = (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        stop(`Pi RPC output exceeded ${maxOutputBytes} bytes`);
        return;
      }
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines.filter((value) => value.trim())) {
        const parsed = parseLine(line);
        if (parsed.error) {
          stop(parsed.error);
          return;
        }
        handleRow(parsed.row);
        if (failure) return;
      }
    };

    const finish = (code, signal, processExited) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(cleanupTimer);
      if (pending.trim() && !failure) failure = `Incomplete trailing RPC output: ${pending.slice(0, 200)}`;
      resolvePromise({ rows, stdout, stderr, exit_code: code ?? 1, signal, process_exited: processExited, failure, redactions: [root, rootDir] });
    };

    const deadline = setTimeout(() => {
      const observed = rows.filter((row) => row.type === "extension_ui_request" && row.method === "notify")
        .map((row) => ({ message: row.message, level: row.notifyType }));
      stop(`Actual Pi RPC probe exceeded ${probeTimeoutMs}ms; inventory=${JSON.stringify(inventory?.data?.commands?.map((command) => command.name))}; notifications=${JSON.stringify(observed)}`);
    }, probeTimeoutMs);

    child.on("error", (error) => stop(`Pi RPC spawn failed: ${error.message}`));
    child.stdin.on("error", (error) => {
      if (!endedInput) stop(`Pi RPC input failed: ${error.message}`);
    });
    child.stdout.on("data", consumeStdout);
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) stop(`Pi RPC output exceeded ${maxOutputBytes} bytes`);
    });
    child.on("close", (code, signal) => finish(code, signal, true));
    child.stdin.write(JSON.stringify({ type: "get_commands", id: "inventory" }) + "\n");
  });
}

function evidenceText(output, failure, redactions = []) {
  let full = [output, failure ? `Harness failure: ${failure}` : ""].filter(Boolean).join("\n");
  for (const value of redactions) {
    full = full.replaceAll(value, "<isolated-checkout>");
    full = full.replaceAll(JSON.stringify(value).slice(1, -1), "<isolated-checkout>");
  }
  return full.length > 6000 ? `${full.slice(-6000)}\n[Evidence tail; all bounded output was checked before truncation; ${full.length} characters total]` : full;
}

function caseResult(name, command, processResult, extras = {}) {
  const fullOutput = `${processResult.stdout ?? ""}${processResult.stderr ?? ""}`;
  const rows = processResult.rows ?? [];
  const inventory = rows.find((row) => row.id === "inventory" && row.type === "response");
  const prompt = rows.find((row) => row.id === "playbook-smoke" && row.type === "response");
  const expectedNotify = extras.expectedNotify ?? (name === "error_path"
    ? { fragment: "A search query or at least one --url is required.", level: "error" }
    : name === "happy_path"
      ? { fragment: "Imported playbook draft 'offline-playbook' from 1 source URL(s).", level: "info" }
      : { fragment: "Completed: host-playbook", level: "info" });
  const notification = rows.find((row) => row.type === "extension_ui_request" && row.method === "notify"
    && row.notifyType === expectedNotify.level && typeof row.message === "string" && row.message.includes(expectedNotify.fragment));
  const agentEvents = rows.filter((row) => agentEventTypes.has(row.type));
  const unhandled_error = UNHANDLED_ERROR_PATTERN.test(fullOutput);
  const extension_load_error = EXTENSION_LOAD_ERROR_PATTERN.test(fullOutput);
  const assertions = behaviorAssertions(name, {
    inventory,
    prompt,
    notification,
    agentEvents: agentEvents.map((row) => ({ type: row.type })),
    exit_code: processResult.exit_code,
    process_exited: processResult.process_exited,
    unhandled_error,
    extension_load_error,
    shell_stdout: extras.shell_stdout,
    shell_stderr: extras.shell_stderr,
    expectedVersion: extras.expectedVersion,
    featureArtifact: extras.featureArtifact,
  });
  const passed = processResult.exit_code === 0 && processResult.process_exited === true
    && !processResult.failure && !unhandled_error && !extension_load_error && assertions.every((item) => item.passed);
  return {
    name,
    command,
    exit_code: processResult.exit_code,
    passed,
    evidence: evidenceText(fullOutput, processResult.failure, processResult.redactions),
    assertions,
    _unhandled_error: unhandled_error,
    _extension_load_error: extension_load_error,
  };
}

function runNativeShell(rootDir, agentDir, expectedVersion) {
  const env = isolatedEnvironment(rootDir, agentDir);
  let result;
  if (process.platform === "win32") {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const shell = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command",
      `& ${quote(process.execPath)} ${quote(piCli)} --no-extensions --version; exit $LASTEXITCODE`], {
      cwd: rootDir, env, encoding: "utf8", timeout: probeTimeoutMs, maxBuffer: maxOutputBytes, windowsHide: true,
    });
  } else {
    result = spawnSync("/bin/sh", ["-c", '"$1" "$2" --no-extensions --version', "pi-host-shell", process.execPath, piCli], {
      cwd: rootDir, env, encoding: "utf8", timeout: probeTimeoutMs, maxBuffer: maxOutputBytes,
    });
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const processResult = {
    stdout,
    stderr,
    exit_code: result.status ?? 1,
    process_exited: result.status !== null || result.signal !== null,
    failure: result.error?.message,
  };
  return caseResult("host_shell", "npm run smoke:pi", processResult, { shell_stdout: stdout, shell_stderr: stderr, expectedVersion });
}

const tempRoot = mkdtempSync(join(tmpdir(), "pi-skill-playbook-sdk-smoke-"));
const agentDir = resolve(tempRoot, "agent");
mkdirSync(resolve(tempRoot, ".pi/playbook-runs"), { recursive: true });
mkdirSync(resolve(tempRoot, ".agents/skills/smoke-skill"), { recursive: true });
writeFileSync(resolve(tempRoot, ".agents/skills/smoke-skill/SKILL.md"), [
  "---", "name: smoke-skill", "description: Offline skill used by the Pi SDK behavior smoke", "---", "",
  "Use this fixture skill only for the isolated compatibility smoke.", "",
].join("\n"));
writeFileSync(resolve(tempRoot, ".pi/playbook-runs/host-run.json"), JSON.stringify({
  runId: "host-run",
  playbookId: "host-playbook",
  currentStep: "done",
  status: "completed",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T01:00:00.000Z",
  history: [{ at: "2026-06-01T01:00:00.000Z", step: "done", outcome: "complete", to: "complete" }],
}));

const sourceBody = "<html><title>Offline source</title><p>A local fixture for the playbook SDK smoke.</p></html>";
let sourceRequestCount = 0;
const sourceServer = createServer((request, response) => {
  if (request.url !== "/source") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  sourceRequestCount += 1;
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(sourceBody);
});

try {
  await new Promise((resolveListen, rejectListen) => {
    sourceServer.once("error", rejectListen);
    sourceServer.listen(0, "127.0.0.1", resolveListen);
  });
  const sourceAddress = sourceServer.address();
  if (!sourceAddress || typeof sourceAddress === "string") throw new Error("Could not bind the local smoke source server");
  const sourceUrl = `http://127.0.0.1:${sourceAddress.port}/source`;
  const cases = [];
  const command = "npm run smoke:pi";
  cases.push(caseResult("extension_load", command, await runRpcProcess({
    rootDir: tempRoot, agentDir, requiredCommand: "playbook:history",
  })));
  cases.push(caseResult("happy_path", command, await runRpcProcess({
    rootDir: tempRoot,
    agentDir,
    requiredCommand: "playbook:import-web",
    promptMessage: `/playbook:import-web --url ${sourceUrl} --id offline-playbook`,
    expectedNotify: { fragment: "Imported playbook draft 'offline-playbook' from 1 source URL(s).", level: "info" },
    model: { provider: "pi-skill-playbook-smoke", modelId: "offline-model" },
  }), {
    expectedNotify: { fragment: "Imported playbook draft 'offline-playbook' from 1 source URL(s).", level: "info" },
    featureArtifact: (() => {
      const path = resolve(tempRoot, ".pi/playbooks/offline-playbook.yml");
      if (!existsSync(path)) return { valid: false, sourceRequestCount };
      let saved;
      try { saved = parseYaml(readFileSync(path, "utf8")); } catch { return { valid: false, sourceRequestCount }; }
      const primarySkill = saved?.steps?.["first-step"]?.primarySkill;
      const sourceUrlInFile = saved?.sources?.[0]?.url;
      return {
        valid: saved?.id === "offline-playbook" && saved?.name === "Offline Playbook"
          && primarySkill === "smoke-skill" && saved?.skills?.["smoke-skill"]?.role === "entry"
          && sourceUrlInFile === sourceUrl,
        sourceRequestCount,
        id: saved?.id,
        primarySkill,
        sourceUrl: sourceUrlInFile,
      };
    })(),
  }));
  cases.push(caseResult("error_path", command, await runRpcProcess({
    rootDir: tempRoot,
    agentDir,
    requiredCommand: "playbook:import-web",
    promptMessage: "/playbook:import-web",
    expectedNotify: { fragment: "A search query or at least one --url is required.", level: "error" },
  })));
  cases.push(caseResult("reload_cleanup", command, await runRpcProcess({
    rootDir: tempRoot,
    agentDir,
    requiredCommand: "playbook:history",
    promptMessage: "/playbook:history",
    expectedNotify: { fragment: "Completed: host-playbook", level: "info" },
  })));
  cases.push(runNativeShell(tempRoot, agentDir, manifestVersions["@earendil-works/pi-coding-agent"]));

  const report = {
    schema_version: 1,
    verification_contract: VERIFICATION_CONTRACT,
    sdk_versions: manifestVersions,
    platform: process.platform,
    model_inference: "the import-web happy path uses the SDK's deterministic in-memory faux provider; no network/paid inference and no main agent loop",
    unhandled_errors: cases.filter((item) => item._unhandled_error).length,
    extension_load_errors: cases.filter((item) => item._extension_load_error
      || (item.name === "extension_load" && !item.assertions.some((assertion) => assertion.id === "extension_registered" && assertion.passed))).length,
    cases: cases.map(({ _unhandled_error, _extension_load_error, ...item }) => item),
  };
  mkdirSync(resolve(root, "docs/verification"), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    verification_contract: VERIFICATION_CONTRACT,
    platform: process.platform,
    sdk_versions: manifestVersions,
    unhandled_errors: report.unhandled_errors,
    extension_load_errors: report.extension_load_errors,
    cases: report.cases.map(({ name, passed, exit_code }) => ({ name, passed, exit_code })),
  }));
  if (report.unhandled_errors !== 0 || report.extension_load_errors !== 0 || report.cases.some((item) => !item.passed)) {
    process.exitCode = 1;
  }
} finally {
  if (sourceServer.listening) {
    await new Promise((resolveClose, rejectClose) => sourceServer.close((error) => error ? rejectClose(error) : resolveClose()));
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
