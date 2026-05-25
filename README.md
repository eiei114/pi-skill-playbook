# Pi Skill Playbook

Pi Skill Playbook is a Pi extension that guides Agent Skill usage flows with visible, human-mediated playbooks.

MVP scope:

- `/playbook list`
- `/playbook start <playbook-id> [--run <name>]`
- `/playbook resume <run-id>`
- `/playbook status [run-id]`
- `/playbook done`
- `/playbook choose <outcome>`
- strict YAML validation
- active run widget below the editor
- marker-based auto advance for single-outcome steps
- local run state in `.pi/playbook-runs/`

Deferred after scaffold:

- `/playbook import-web`
- `/playbook record`

## Install from npm

```bash
pi install npm:pi-skill-playbook
```

Package version: `0.1.0`

## Install locally

```bash
cd C:/Users/Keisu/Projects/OSS/pi-skill-playbook
npm install
pi -e .
```

Or install as a local Pi package:

```bash
pi install C:/Users/Keisu/Projects/OSS/pi-skill-playbook
```

## Add a playbook to a project

MVP uses manual sample copy:

```bash
mkdir -p .pi/playbooks
cp C:/Users/Keisu/Projects/OSS/pi-skill-playbook/samples/feature-development.yml .pi/playbooks/feature-development.yml
```

Add personal run state to the target repo's `.gitignore`:

```gitignore
.pi/playbook-runs/
```

## Use

```text
/playbook list
/playbook start feature-development --run my-feature
/playbook done
/playbook choose pass
/playbook status
```

The widget displays the current step, exact skill command, completion criteria, and outcome labels.

## Auto advance

Playbooks default to `autoAdvance: auto`.

When a user explicitly runs the current step skill with `/skill:<name>`, Pi Skill Playbook injects a short prompt that asks the assistant to leave a visible completion marker:

```text
PLAYBOOK_OUTCOME: ready-for-prd
```

If the current step has exactly one outcome, a valid marker advances the run automatically. If the step has multiple outcomes, the marker is shown as a suggestion and the user must confirm with `/playbook choose <outcome>`.

Optional playbook setting:

```yaml
autoAdvance: auto     # default: marker can advance single-outcome steps
autoAdvance: suggest  # marker only suggests /playbook done or /playbook choose
autoAdvance: off      # no prompt injection or completion detection
```
