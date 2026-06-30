# Auto Advance regression fixtures

Transcript/turn fixtures for marker-based Auto Advance. Each scenario file
describes one agent turn: user skill invocation, assistant response text, and
the expected completion plan.

Run the suite with `npm test` (`tests/auto-advance-fixtures.test.ts`).

## Layout

```text
tests/fixtures/auto-advance/
  README.md           # this file
  playbook.json       # shared playbook definition for all scenarios
  scenarios/*.json    # one file per regression case
```

## Adding a scenario

1. Create `scenarios/<slug>.json` (kebab-case slug; `id` field must match).
2. Set `currentStep` to a step id from `playbook.json`.
3. Optionally set `autoAdvance` to override the playbook default (`auto`).
4. Fill `turn.userInput` with the user message (include `/skill:<name>` when the
   step skill is invoked).
5. Fill `turn.assistantText` with the assistant reply (include
   `PLAYBOOK_OUTCOME:` or `PLAYBOOK_DONE` when testing markers).
6. Set `expect.plan` to the expected `planCompletion` result (`null` = no plan).
7. Set `expect.mutatesState` to whether the run should auto-advance
   (`plan.kind === "auto"`).

The test runner loads every `scenarios/*.json` file automatically.

## Scenario schema

```json
{
  "id": "auto-single-outcome-with-marker",
  "description": "Human-readable summary for test output.",
  "autoAdvance": "auto",
  "currentStep": "grill",
  "turn": {
    "userInput": "/skill:grill-with-docs analyze the feature",
    "assistantText": "Boundary is clear.\nPLAYBOOK_OUTCOME: ready-for-prd"
  },
  "expect": {
    "plan": {
      "kind": "auto",
      "outcome": "ready-for-prd",
      "to": "prd",
      "messageIncludes": "Auto-advancing"
    },
    "mutatesState": true,
    "prompt": {
      "includes": ["PLAYBOOK_OUTCOME: ready-for-prd"]
    }
  }
}
```

### `expect.plan`

| Field | Meaning |
| --- | --- |
| `null` | `planCompletion` must return `undefined` (`off` mode or no signal). |
| `kind` | `auto`, `suggest`, `warning`, or `ignore`. |
| `outcome`, `to` | Optional; asserted when present. |
| `messageIncludes` | Substring that must appear in `plan.message`. |

### `expect.prompt` (optional)

| Field | Meaning |
| --- | --- |
| `absent: true` | `renderPlaybookPrompt` must return `undefined` (`off` mode). |
| `includes` | Each string must appear in the rendered prompt. |

### `expect.mutatesState`

`true` when Auto Advance should change run state: single-outcome `auto` plans
and final-step completion (`plan.to === "complete"`). Invalid markers,
wrong-skill warnings, `suggest` plans, and `off` mode must use `false`.

## Covered cases (baseline)

| Scenario | Mode | Signal |
| --- | --- | --- |
| `auto-single-outcome-with-marker` | `auto` | skill + valid marker |
| `suggest-mode-with-marker` | `suggest` | skill + marker → suggest only |
| `off-mode-ignores-turn` | `off` | skill + marker → no plan |
| `missing-marker-suggest-only` | `auto` | skill, no marker |
| `wrong-skill-with-marker` | `auto` | marker without skill invocation |
| `wrong-skill-no-marker` | `auto` | neither skill nor marker |
| `multi-outcome-with-marker` | `auto` | skill + marker on branching step |
| `invalid-marker-outcome` | `auto` | skill + unknown outcome |
| `auto-final-step-playbook-done` | `auto` | final step + `PLAYBOOK_DONE` |
