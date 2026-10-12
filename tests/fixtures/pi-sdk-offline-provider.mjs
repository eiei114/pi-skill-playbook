import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";

const response = [
  "```yaml",
  "version: 1",
  "id: offline-playbook",
  "name: Offline Playbook",
  "entry: first-step",
  "skills:",
  "  smoke-skill:",
  "    role: entry",
  "steps:",
  "  first-step:",
  "    primarySkill: smoke-skill",
  "    commandHint: \"/skill:smoke-skill\"",
  "    doneWhen:",
  "      - The local source is represented.",
  "    transitions:",
  "      - outcome: complete",
  "        to: complete",
  "```",
].join("\n");

const provider = fauxProvider({
  provider: "pi-skill-playbook-smoke",
  models: [{ id: "offline-model", name: "Pi Skill Playbook offline smoke model", reasoning: false }],
});
provider.setResponses([(context) => {
  const userText = context.messages
    .filter((message) => message.role === "user")
    .map((message) => typeof message.content === "string"
      ? message.content
      : message.content.map((part) => part.type === "text" ? part.text : "").join("\n"))
    .join("\n");
  if (!userText.includes("A local fixture for the playbook SDK smoke.")) {
    return fauxAssistantMessage(fauxText("ERROR: the fetched local source was not included in the model request."));
  }
  return fauxAssistantMessage(fauxText(response));
}]);

export default function registerOfflineSmokeProvider(pi) {
  pi.registerProvider(provider.provider);
}
