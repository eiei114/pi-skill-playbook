# Marker-based auto advance

Pi Skill Playbook defaults to marker-based **Auto Advance**: a run may advance automatically only when the active step's primary skill was explicitly invoked with `/skill:<name>` and the assistant emits a visible `PLAYBOOK_OUTCOME: <outcome>` marker. This keeps single-outcome workflows low-friction without turning playbooks into hidden skill automation; markerless completions only produce an advance suggestion, and multi-outcome steps still require explicit outcome choice.

## Considered Options

- Fully automatic advancement after any matching skill invocation: rejected because failed or partial skill runs could silently advance the run.
- Suggest-only advancement: rejected as too close to the existing `/playbook done` workflow.
- Hidden structured metadata: rejected because visible markers make state changes auditable in conversation history.

## Consequences

- Playbook prompts must tell the assistant the valid outcomes and marker format for the active step.
- `autoAdvance` defaults to `auto`, with `suggest` and `off` available per playbook.
- Auto advance changes run state and widget state only; it never runs the next skill or writes commands into the editor.
