import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url));
const extension = fileURLToPath(new URL("../extensions/index.ts", import.meta.url));
// Explicit finite deadline per spawned Pi process (30s maximum, plus one cleanup grace second).
const PROBE_DEADLINE_MS = 30_000;
interface Row {
  type?: string; id?: string; success?: boolean; method?: string; message?: string; notifyType?: string;
  data?: { commands?: Array<{ name: string }>; disposition?: string };
}

async function hostHistory(root: string, expected: RegExp, level: string): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "--offline", "--no-session", "--no-tools", "--no-extensions",
      "--no-skills", "--no-context-files", "--no-prompt-templates", "-e", extension, "--mode", "rpc"],
    { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent") }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const rows: Row[] = [];
    let tail = "", stderr = "", bytes = 0, sent = false, ended = false, failure = "";
    let cleanup: ReturnType<typeof setTimeout> | undefined;
    const stop = (message: string) => {
      if (failure) return;
      failure = message; child.kill();
      cleanup = setTimeout(() => {
        child.kill("SIGKILL"); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        reject(new Error(message));
      }, 1000);
    };
    const deadline = setTimeout(() => stop(`actual Pi probe deadline: inventory=${JSON.stringify(rows.find((r) => r.id === "inventory")?.data?.commands?.map((c) => c.name))}; notifications=${JSON.stringify(rows.filter((r) => r.method === "notify").map((r) => ({ message: r.message, level: r.notifyType })))}; stderr=${stderr.slice(-500)}`), PROBE_DEADLINE_MS);
    child.on("error", () => { clearTimeout(deadline); reject(new Error("actual Pi spawn failed")); });
    child.stdin.on("error", () => stop("actual Pi input failure"));
    child.stderr.on("data", (block: Buffer) => {
      bytes += block.length; if (bytes > 1024 * 1024) stop("actual Pi output over budget"); else stderr += block.toString("utf8");
    });
    child.stdout.on("data", (block: Buffer) => {
      bytes += block.length; if (bytes > 1024 * 1024) { stop("actual Pi output over budget"); return; }
      tail += block.toString("utf8"); const lines = tail.split(/\r?\n/); tail = lines.pop() ?? "";
      for (const line of lines.filter((value) => value.trim())) {
        let row: Row;
        try { row = JSON.parse(line); } catch { stop("non-JSON actual Pi response"); return; }
        rows.push(row);
        if (!sent && row.id === "inventory" && row.success && row.data?.commands?.some((c) => c.name === "playbook:history")) {
          sent = true; child.stdin.write(JSON.stringify({ type: "prompt", id: "history", message: "/playbook:history" }) + "\n");
        }
        const prompt = rows.find((r) => r.id === "history" && r.type === "response");
        const notify = rows.find((r) => r.type === "extension_ui_request" && r.method === "notify" && expected.test(r.message ?? "") && r.notifyType === level);
        if (prompt && !prompt.success) { stop("actual Pi history rejected"); return; }
        // Older locked SDKs omit disposition. Real feature notification AND
        // prompt success plus the no-inference assertion still remain required.
        const handled = prompt?.data?.disposition === undefined || prompt.data.disposition === "handled";
        if (!ended && prompt?.success && handled && notify) { ended = true; child.stdin.end(); }
      }
    });
    child.on("close", (code) => {
      clearTimeout(deadline); clearTimeout(cleanup);
      if (failure || code !== 0 || stderr.trim() || tail.trim() || !ended) reject(new Error(failure || `incomplete actual Pi history: exit=${code} ${stderr.slice(-500)}`));
      else resolve(rows);
    });
    child.stdin.write(JSON.stringify({ type: "get_commands", id: "inventory" }) + "\n");
  });
}

const completedRun = { runId: "host-run", playbookId: "host-playbook", currentStep: "done", status: "completed",
  createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T01:00:00Z",
  history: [{ at: "2026-06-01T01:00:00Z", step: "done", outcome: "complete", to: "complete" }] };

test("actual Pi history renders a completed run, handles corrupt state and reloads without inference", { timeout: 130_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "playbook-real-history-"));
  const runPath = join(root, ".pi/playbook-runs/host-run.json");
  const brokenPath = join(root, ".pi/playbook-runs/broken-run.json");
  try {
    await mkdir(join(root, ".pi/playbook-runs"), { recursive: true });
    for (const corrupt of [false, true, false]) {
      await writeFile(runPath, JSON.stringify(completedRun));
      if (corrupt) await writeFile(brokenPath, "not valid json", "utf8");
      else await rm(brokenPath, { force: true });

      const rows = await hostHistory(root, /Completed: host-playbook/, corrupt ? "warning" : "info");
      assert.ok(!rows.some((r) => ["agent_start", "message_start", "tool_execution_start"].includes(r.type ?? "")));

      const message = rows.find((r) => r.method === "notify" && (r.message?.includes("Completed: host-playbook") ?? false))?.message ?? "";
      // The healthy completed run is listed whether or not another run file is damaged.
      assert.match(message, /Run: host-run/);
      assert.match(message, /Final outcome: complete/);
      if (corrupt) {
        // The damaged file is named once with an actionable cause, never as a raw parser error.
        assert.match(message, /broken-run\.json/);
        assert.match(message, /cannot be read: invalid JSON/);
        assert.match(message, /left unchanged/);
        assert.doesNotMatch(message, /Unexpected token/);
        assert.equal(rows.filter((r) => r.method === "notify" && (r.message?.includes("broken-run.json") ?? false)).length, 1);
      } else {
        assert.doesNotMatch(message, /broken-run\.json/);
      }
      // No state file was deleted or rewritten automatically.
      if (corrupt) assert.equal(await readFile(brokenPath, "utf8"), "not valid json");
      assert.equal(await readFile(runPath, "utf8"), JSON.stringify(completedRun));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
