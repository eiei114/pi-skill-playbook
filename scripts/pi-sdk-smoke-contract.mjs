export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_VERSIONS = Object.freeze({
  "@earendil-works/pi-agent-core": "1.2.0",
  "@earendil-works/pi-ai": "1.2.0",
  "@earendil-works/pi-coding-agent": "1.2.0",
  "@earendil-works/pi-tui": "1.2.0",
});

export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension/i;

export function parseJsonLines(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

function registrationAssertion(inventory) {
  const names = inventory?.data?.commands?.map((command) => command.name) ?? [];
  const required = ["playbook:list", "playbook:history", "playbook:import-web"];
  return assertion(
    "extension_registered",
    `Actual Pi registers ${required.join(", ")}`,
    { success: inventory?.success === true, commands: names },
    inventory?.success === true && required.every((name) => names.includes(name)),
  );
}

function noAgentTurnAssertion(agentEvents) {
  return assertion(
    "no_agent_turn",
    "The actual Pi extension command completes without starting the main agent loop",
    agentEvents,
    agentEvents.length === 0,
  );
}

function featureAssertion(id, prompt, notification, expectedFragment, expectedLevel) {
  const handled = prompt?.success === true && prompt.data?.disposition === "handled";
  const notified = notification?.method === "notify"
    && notification.notifyType === expectedLevel
    && typeof notification.message === "string"
    && notification.message.includes(expectedFragment);
  return assertion(
    id,
    `The actual extension command returns handled and emits a ${expectedLevel} notification containing ${JSON.stringify(expectedFragment)}`,
    { response: prompt ?? null, notification: notification ?? null },
    handled && notified,
  );
}

export function behaviorAssertions(name, {
  inventory,
  prompt,
  notification,
  agentEvents = [],
  exit_code,
  process_exited,
  unhandled_error = false,
  extension_load_error = false,
  shell_stdout = "",
  shell_stderr = "",
  expectedVersion,
  featureArtifact,
}) {
  if (name === "extension_load") {
    return [registrationAssertion(inventory), noAgentTurnAssertion(agentEvents)];
  }
  if (name === "happy_path") {
    return [
      featureAssertion("feature_response", prompt, notification, "Imported playbook draft 'offline-playbook' from 1 source URL(s).", "info"),
      assertion(
        "offline_model_draft_saved",
        "The SDK's faux provider response becomes a saved, skill-mapped playbook with source trace from one local HTTP fixture",
        featureArtifact ?? null,
        featureArtifact?.valid === true && featureArtifact.sourceRequestCount === 1,
      ),
      noAgentTurnAssertion(agentEvents),
    ];
  }
  if (name === "error_path") {
    return [
      featureAssertion("handled_error", prompt, notification, "A search query or at least one --url is required.", "error"),
      noAgentTurnAssertion(agentEvents),
    ];
  }
  if (name === "reload_cleanup") {
    return [
      assertion(
        "reloaded_extension_registered",
        "A second actual Pi process registers the playbook extension commands",
        { success: inventory?.success === true, commands: inventory?.data?.commands?.map((command) => command.name) ?? [] },
        registrationAssertion(inventory).passed,
      ),
      featureAssertion("reloaded_feature_response", prompt, notification, "Completed: host-playbook", "info"),
      assertion(
        "clean_shutdown",
        "The second actual Pi process exits zero without unhandled, load, or shutdown errors",
        { exit_code, process_exited, unhandled_error, extension_load_error },
        exit_code === 0 && process_exited === true && !unhandled_error && !extension_load_error,
      ),
      noAgentTurnAssertion(agentEvents),
    ];
  }
  if (name === "host_shell") {
    return [assertion(
      "native_shell_boundary",
      `The native host shell launches the locally pinned Pi CLI and returns exactly ${expectedVersion}`,
      { exit_code, process_exited, stdout: shell_stdout.trim(), stderr: shell_stderr.trim(), expectedVersion },
      exit_code === 0 && process_exited === true && shell_stdout.trim() === expectedVersion,
    )];
  }
  throw new Error(`Unknown smoke case: ${name}`);
}
