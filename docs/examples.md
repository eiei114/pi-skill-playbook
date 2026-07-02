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
- `/playbook:history` lists completed runs as read-only history. Active runs still resume with `/playbook:resume`.

For Pi OSS samples, run the skill named in the widget's command hint at each step. Single-outcome steps can auto-advance when the assistant emits a visible `PLAYBOOK_OUTCOME:` marker.

## Compare recent playbook runs

After multiple completed runs, compare the two most recent runs with `/playbook:rundiff`:

```text
/playbook:rundiff
```

Output shows a compact diff: newer vs older run, playbook name, final outcome, and per-step differences.

### Regression/debugging example

After a CI rebuild in a Pi OSS delivery, the `review` step previously passed but now fails:

```text
> /playbook:rundiff
Run diff: oss-delivery-20260630-v2 vs oss-delivery-20260629-v1
  Newer: Pi OSS New Delivery (2026-06-30T14:00:00.000Z) — fail
  Older: Pi OSS New Delivery (2026-06-29T12:00:00.000Z) — pass
Changes:
  Step 5 "review" differs: outcome "fail" was "pass"
```

Dogfood on this regression case showed the summary is enough for triage: five
lines versus opening two raw run files (~60+ lines of JSON). The header already
shows final outcomes, so the change list focuses on the step that regressed.
Use `/playbook:history` when you need timestamps or the full per-step trail.

### When to use rundiff vs history

| Use case | Command |
| --- | --- |
| Spot-checking whether the latest run changed vs the previous one | `/playbook:rundiff` |
| Comparing non-adjacent runs (pick a pair when multiple diffs exist) | `/playbook:rundiff` |
| Browsing all completed runs (metadata) | `/playbook:history` |
| Drilling into one run's full history | `/playbook:history` then select a run |
| Checking active run status | `/playbook:status` |

Skip `/playbook:rundiff` when runs took different playbook paths — aligned
step diffs can cascade. In that case start with `/playbook:history` and inspect
each run's trail.
