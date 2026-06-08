# Pi Skill Playbook

[![CI](https://github.com/eiei114/pi-skill-playbook/actions/workflows/auto-release.yml/badge.svg)](https://github.com/eiei114/pi-skill-playbook/actions/workflows/auto-release.yml)
[![Publish](https://github.com/eiei114/pi-skill-playbook/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-skill-playbook/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/pi-skill-playbook.svg)](https://www.npmjs.com/package/pi-skill-playbook)
[![npm downloads](https://img.shields.io/npm/dt/pi-skill-playbook.svg)](https://www.npmjs.com/package/pi-skill-playbook)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pi package](https://img.shields.io/badge/Pi-package-blue)](https://github.com/eiei114/pi-skill-playbook)

Human-mediated Agent Skill playbooks for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

## What this is

Pi Skill Playbook is a Pi extension that guides Agent Skill usage flows with **visible, human-controlled playbooks**. It shows the current workflow step, next recommended skill command, and completion criteria — but never runs skills automatically.

Define ordered skill workflows as YAML playbooks in your project, then drive them step by step from the Pi command palette.

## Features

- **Playbook-driven workflows** — Define multi-step skill sequences with named outcomes and transitions in YAML.
- **Human-mediated** — Every step requires an explicit user action. No hidden automation.
- **Marker-based auto advance** — Single-outcome steps advance automatically when the assistant emits a visible `PLAYBOOK_OUTCOME:` marker. Multi-outcome steps always require explicit confirmation.
- **Active run widget** — Displays current step, skill command, completion criteria, and outcome labels below the editor.
- **Strict YAML validation** — Playbooks are validated on load for structure, transitions, and skill references.
- **Tab completion** — Commands, playbook IDs, run IDs, outcomes, and flags all support tab completion.
- **Local run state** — Run state is stored in `.pi/playbook-runs/` inside the target project, never in git.

## Install

### From npm

```bash
pi install npm:pi-skill-playbook
```

### From GitHub

```bash
pi install git:github.com/eiei114/pi-skill-playbook
```

Or with a full Git URL:

```bash
pi install git+https://github.com/eiei114/pi-skill-playbook.git
```

### Locally (for development)

```bash
git clone https://github.com/eiei114/pi-skill-playbook.git
cd pi-skill-playbook
npm install
pi -e .
```

## Quick start

1. **Copy a sample playbook** into your project:

   ```bash
   mkdir -p .pi/playbooks
   cp node_modules/pi-skill-playbook/samples/feature-development.yml .pi/playbooks/
   ```

2. **Add run state to `.gitignore`** in the target project:

   ```gitignore
   .pi/playbook-runs/
   ```

3. **Start a run** from the Pi TUI:

   ```
   /playbook:list
   /playbook:start
   ```

   When more than one playbook exists, Pi shows a selector with validation status for each playbook. The run id is generated automatically.

4. **Drive the workflow**:

   ```
   /skill:grill-with-docs <feature idea>
   /playbook:done
   /playbook:choose
   /playbook:status
   ```

The widget displays the current step, exact skill command, completion criteria, and outcome labels.

## Usage summary

| Command | Description |
|---|---|
| `/playbook:list` | List available playbooks with validation status |
| `/playbook:start` | Select a playbook and start a new run |
| `/playbook:resume` | Select an active run to resume |
| `/playbook:status [run-id]` | Show current step and completion criteria |
| `/playbook:done` | Complete the current step (auto-advances if single outcome) |
| `/playbook:choose` | Select an outcome for multi-branch steps |
| `/playbook:cancel` | Select and confirm an active run cancellation |

Legacy explicit-argument forms (`/playbook:start <id>`, `/playbook:resume <run-id>`, `/playbook:choose <outcome>`, `/playbook:cancel <run-id>`, and space-separated `/playbook start`) remain available for scripts and non-interactive use.

### Auto advance

Playbooks default to `autoAdvance: auto`. When a user explicitly runs the current step's skill with `/skill:<name>`, Pi Skill Playbook injects a short prompt asking the assistant to emit a visible completion marker:

```text
PLAYBOOK_OUTCOME: ready-for-prd
```

| Mode | Behavior |
|---|---|
| `auto` (default) | Marker can advance single-outcome steps automatically |
| `suggest` | Marker only suggests `/playbook:done` or `/playbook:choose` |
| `off` | No prompt injection or completion detection |

## Package contents

```
pi-skill-playbook/
├── extensions/     Pi extension entry point
├── src/            Domain logic: validation, state, rendering, auto-advance
├── samples/        Example playbooks (feature-development.yml)
├── tests/          Node.js test suite
├── docs/adr/       Architecture decision records
├── LICENSE         MIT
└── README.md
```

### Playbook YAML structure

```yaml
version: 1
id: my-playbook
name: My Playbook
entry: first-step
autoAdvance: auto        # auto | suggest | off

skills:
  my-skill:
    role: entry

steps:
  first-step:
    primarySkill: my-skill
    commandHint: "/skill:my-skill <arg>"
    doneWhen:
      - Criterion one.
      - Criterion two.
    transitions:
      - outcome: done
        to: complete        # "complete" ends the run
```

See [`samples/feature-development.yml`](samples/feature-development.yml) for a full example.

## Development

```bash
npm install
npm run check     # TypeScript type check
npm test          # Run tests (Node.js built-in test runner + tsx)
```

Requires Node.js ≥ 24, TypeScript 5.8+, and tsx 4.20+.

## Release

Releases are automated via GitHub Actions:

1. Bump `version` in `package.json` and merge to `main`.
2. `auto-release.yml` detects the new version, creates a git tag and GitHub Release.
3. `publish.yml` publishes to npm with provenance.

Manual dispatch is also available from the Actions tab.

## Security

- Run state is local-only (`.pi/playbook-runs/`). No data leaves the machine.
- The extension does **not** inject system prompts for skill execution. It only adds a short playbook prompt describing the current step, valid outcomes, and expected marker format.
- No automatic file edits — the extension warns with a `.gitignore` snippet instead of modifying files.
- Report vulnerabilities via [GitHub Security Advisories](https://github.com/eiei114/pi-skill-playbook/security/advisories/new).

## Links

- [npm package](https://www.npmjs.com/package/pi-skill-playbook)
- [GitHub repository](https://github.com/eiei114/pi-skill-playbook)
- [Pi coding agent](https://github.com/earendil-works/pi-coding-agent)
- [Architecture decisions](docs/adr/)

## License

[MIT](LICENSE)
