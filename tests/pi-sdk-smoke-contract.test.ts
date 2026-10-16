import assert from "node:assert/strict";
import test from "node:test";
import {
  behaviorAssertions,
  parseJsonLines,
  SDK_VERSIONS,
  VERIFICATION_CONTRACT,
} from "../scripts/pi-sdk-smoke-contract.mjs";
import type { BehaviorInput } from "../scripts/pi-sdk-smoke-contract.mjs";

const inventory = {
  type: "response",
  success: true,
  data: { commands: ["playbook:list", "playbook:history", "playbook:import-web"].map((name) => ({ name })) },
};
const prompt = { type: "response", command: "prompt", success: true, data: { disposition: "handled" } };
const history = { type: "extension_ui_request", method: "notify", notifyType: "info", message: "Completed: host-playbook" };
const imported = {
  type: "extension_ui_request",
  method: "notify",
  notifyType: "info",
  message: "Imported playbook draft 'offline-playbook' from 1 source URL(s).",
};
const handledError = {
  type: "extension_ui_request",
  method: "notify",
  notifyType: "error",
  message: "A search query or at least one --url is required.",
};
const savedArtifact = {
  valid: true,
  sourceRequestCount: 1,
  id: "offline-playbook",
  primarySkill: "smoke-skill",
  sourceUrl: "http://127.0.0.1/source",
};
const input = (overrides: Partial<BehaviorInput> = {}): BehaviorInput => ({
  inventory,
  prompt,
  notification: history,
  agentEvents: [],
  exit_code: 0,
  process_exited: true,
  ...overrides,
});

test("SDK smoke contract uses the frozen SDK dictionary and handles LF/CRLF RPC lines", () => {
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v2");
  assert.deepEqual(SDK_VERSIONS, {
    "@earendil-works/pi-agent-core": "1.2.0",
    "@earendil-works/pi-ai": "1.2.0",
    "@earendil-works/pi-coding-agent": "1.2.0",
    "@earendil-works/pi-tui": "1.2.0",
  });
  assert.deepEqual(parseJsonLines(`not-json\r\n${JSON.stringify(prompt)}\n\n`), [prompt]);
});

test("actual package feature and handled negative path require response plus observed notification", () => {
  const happy = behaviorAssertions("happy_path", input({ featureArtifact: savedArtifact, notification: imported }));
  assert.equal(happy[0].id, "feature_response");
  assert.ok(happy.every((assertion) => assertion.passed));

  const error = behaviorAssertions("error_path", input({ notification: handledError }));
  assert.equal(error[0].id, "handled_error");
  assert.ok(error.every((assertion) => assertion.passed));

  for (const missing of [undefined, { ...prompt, success: false }, { ...prompt, data: { disposition: "queued" } }]) {
    assert.equal(behaviorAssertions("happy_path", input({ prompt: missing, featureArtifact: savedArtifact }))[0].passed, false);
  }
  for (const artifact of [undefined, { ...savedArtifact, valid: false }, { ...savedArtifact, sourceRequestCount: 0 }]) {
    assert.equal(behaviorAssertions("happy_path", input({ featureArtifact: artifact }))[1].passed, false);
  }
  for (const notification of [undefined, { ...handledError, notifyType: "info" }, { ...handledError, message: "" }]) {
    assert.equal(behaviorAssertions("error_path", input({ notification }))[0].passed, false);
  }
});

test("registration and reload assertions fail closed on missing real registration/feature responses", () => {
  assert.ok(behaviorAssertions("extension_load", input())[0].passed);
  assert.equal(behaviorAssertions("extension_load", input({ inventory: undefined }))[0].passed, false);

  const good = behaviorAssertions("reload_cleanup", input());
  assert.deepEqual(good.slice(0, 3).map((assertion) => assertion.id), [
    "reloaded_extension_registered", "reloaded_feature_response", "clean_shutdown",
  ]);
  assert.ok(good.every((assertion) => assertion.passed));
  for (const overrides of [
    { inventory: undefined },
    { prompt: undefined },
    { notification: undefined },
    { exit_code: 1 },
    { process_exited: false },
    { unhandled_error: true },
    { extension_load_error: true },
  ]) {
    assert.ok(behaviorAssertions("reload_cleanup", input(overrides)).some((assertion) => !assertion.passed));
  }
});

test("feature paths reject agent-start events and host shell requires exact pinned version", () => {
  assert.equal(behaviorAssertions("happy_path", input({
    agentEvents: [{ type: "agent_start" }],
    featureArtifact: savedArtifact,
  }))[2].passed, false);
  assert.equal(behaviorAssertions("host_shell", input({
    shell_stdout: "1.2.0\r\n",
    shell_stderr: "",
    expectedVersion: "1.2.0",
  }))[0].passed, true);
  for (const output of ["", "11.2.0", "1.2.0 with warning", "1.0.0"]) {
    assert.equal(behaviorAssertions("host_shell", input({
      shell_stdout: output,
      shell_stderr: "",
      expectedVersion: "1.2.0",
    }))[0].passed, false);
  }
});
