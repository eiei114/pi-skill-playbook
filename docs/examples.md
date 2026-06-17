# Examples

## Selection-first TUI flow

Copy or create YAML playbooks in the target project under `.pi/playbooks/`, then use argument-free commands from the Pi TUI:

```text
/playbook:start
/skill:grill-with-docs <feature idea>
/playbook:done
/playbook:choose
/playbook:status
```

- `/playbook:start` opens a playbook selector when multiple playbooks exist and generates the run id automatically.
- `/playbook:resume` opens an active-run selector.
- `/playbook:choose` opens a selector for the current step's valid outcomes.
- `/playbook:cancel` selects an active run when needed and asks for confirmation before marking it cancelled.
