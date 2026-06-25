# Examples

## Copy a sample into your project

Package samples ship under `samples/`. Copy the playbook that matches your lane into the target project's `.pi/playbooks/` folder:

```bash
mkdir -p .pi/playbooks

# Generic feature development
cp node_modules/pi-skill-playbook/samples/feature-development.yml .pi/playbooks/

# Pi OSS delivery lane (idea -> PRD -> issues -> TDD -> review -> PR verify -> release post)
cp node_modules/pi-skill-playbook/samples/pi-oss-new.yml .pi/playbooks/

# Pi OSS bootstrap only (repo + vault setup -> PRD -> issues)
cp node_modules/pi-skill-playbook/samples/pi-oss-bootstrap-only.yml .pi/playbooks/

# Multica OSS maintenance onboarding
cp node_modules/pi-skill-playbook/samples/oss-maintenance-onboard.yml .pi/playbooks/
```

Add run state to the target repo's `.gitignore`:

```gitignore
.pi/playbook-runs/
```

## Start a run

From the Pi TUI, list playbooks and start one with the selection UI:

```text
/playbook:list
/playbook:start
```

When multiple playbooks exist, Pi shows a selector with validation status for each file. The run id is generated automatically.

## Drive the workflow

```text
/skill:grill-with-docs <feature idea>
/playbook:done
/playbook:choose
/playbook:status
```

- `/playbook:start` opens a playbook selector when multiple playbooks exist and generates the run id automatically.
- `/playbook:resume` opens an active-run selector.
- `/playbook:choose` opens a selector for the current step's valid outcomes.
- `/playbook:cancel` selects an active run when needed and asks for confirmation before marking it cancelled.

For Pi OSS samples, run the skill named in the widget's command hint at each step. Single-outcome steps can auto-advance when the assistant emits a visible `PLAYBOOK_OUTCOME:` marker.
