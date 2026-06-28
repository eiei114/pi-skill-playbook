# Pi Skill Playbook

Pi Skill Playbook coordinates human-mediated Agent Skill workflows in Pi by showing the current workflow state and next recommended skill command.

## Language

**Playbook**:
A project-local workflow definition that describes ordered skill-guided steps and allowed transitions.
_Avoid_: Script, automation

**Run**:
An in-progress or completed execution instance of a **Playbook**.
_Avoid_: Session, job

**Step**:
A named position in a **Playbook** that points to one primary Agent Skill and completion criteria.
_Avoid_: Task, phase

**Outcome**:
A named result of a completed **Step** that selects the next **Step** or completes the **Run**.
_Avoid_: Status, result

**Auto Advance**:
The default behavior where a completed single-outcome **Step** advances without `/playbook:done`, while multi-outcome **Steps** still wait for explicit outcome choice.
_Avoid_: Full automation, auto-run

**Advance Mode**:
A **Playbook** setting that chooses whether completion signals advance automatically, only suggest advancement, or do nothing.
_Avoid_: Auto flag, detection mode

**Completion Signal**:
Evidence that a primary Agent Skill has finished the current **Step**, combining detected skill invocation with an explicit assistant marker when available.
_Avoid_: Guess, heuristic

**Skill Invocation**:
An explicit user input that starts with `/skill:<name>` and matches the current **Step** primary skill.
_Avoid_: Natural-language request, assistant mention

**Outcome Marker**:
A plain-text assistant line of the form `PLAYBOOK_OUTCOME: <outcome>` that identifies the **Outcome** for a completed **Step**.
_Avoid_: Hidden metadata, JSON envelope

**Playbook Prompt**:
A short runtime instruction injected while a **Run** is active that tells the assistant the current **Step**, valid **Outcomes**, and expected **Outcome Marker**.
_Avoid_: Skill modification, static instruction

**Visible Marker**:
An **Outcome Marker** that remains in the assistant response for traceability instead of being stripped before display.
_Avoid_: Hidden transition

**Advance Suggestion**:
A widget and notification hint shown when the current primary skill appears to have run but no valid **Outcome Marker** was emitted.
_Avoid_: Soft advance, silent guess

## Relationships

- A **Playbook** defines one or more **Steps**.
- A **Run** belongs to exactly one **Playbook**.
- A **Step** has one primary Agent Skill and zero or more **Outcomes**.
- An **Outcome** points to another **Step** or completes the **Run**.
- **Auto Advance** applies only when a **Step** has exactly one **Outcome**.
- **Advance Mode** defaults to `auto` when omitted.
- A **Skill Invocation** is the only invocation evidence used for **Completion Signals** in the initial design.
- A **Completion Signal** may advance a single-outcome **Step** automatically when the assistant provides an explicit marker; otherwise it may only suggest advancement.
- An **Outcome Marker** without a matching **Skill Invocation** is ignored for state changes and surfaced as a warning.
- An **Outcome Marker** names one **Outcome** and can drive **Auto Advance** when valid for the current **Step**.
- A **Playbook Prompt** is derived from the active **Run** and avoids editing each Agent Skill individually.
- A **Playbook Prompt** takes effect on the next agent turn after `/playbook:start` and does not start Agent Skills automatically.
- A **Visible Marker** explains why a **Run** advanced and remains available in conversation history.
- An **Advance Suggestion** never changes **Run** state by itself.
- **Auto Advance** updates **Run** state and the widget, but never writes the next command into the editor.

## Run lifecycle

- **Active runs** are resumable via `/playbook:resume` and drive `/playbook:status`, the widget, and playbook prompts.
- **Completed runs** remain in `.pi/playbook-runs/` as read-only history. Browse them with `/playbook:history`; they do not resume and do not change active-run behavior.
- **Cancelled runs** are kept for audit but are excluded from the completed history browser.

## Example dialogue

> **Dev:** "When the `grill` **Step** finishes, should the **Run** require `/playbook:done`?"
> **Domain expert:** "No — **Auto Advance** should move single-outcome **Steps** forward by default, but `review` still needs an explicit **Outcome** like `pass` or `fail`."

## Flagged ambiguities

- "auto" could mean automatically running Agent Skills or only advancing the **Run** state — resolved: **Auto Advance** changes playbook state only; it does not execute skills.
- "detect completion" could mean treating any skill invocation as done — resolved: a **Completion Signal** requires skill invocation plus explicit marker for automatic advancement, with markerless cases limited to suggestions.
