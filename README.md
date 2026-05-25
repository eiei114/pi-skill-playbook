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
- local run state in `.pi/playbook-runs/`

Deferred after scaffold:

- `/playbook import-web`
- `/playbook record`

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
