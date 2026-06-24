# Roadmap

This roadmap governs maintenance of **pi-skill-playbook** — a Pi extension that
guides Agent Skill usage flows with visible, human-controlled playbooks. It shows
the current workflow step, next recommended skill command, and completion criteria,
but never runs skills automatically.

> **Direction source:** `oss-maintenance-roadmap-direction-v1`
> This is a **maintenance-first** project. We prioritize hardening the existing
> surface over expanding it.

## Guiding principles

1. **Stabilization before expansion.** The seven `playbook:*` commands, the YAML
   playbook schema, the marker-based auto-advance model, and the active-run widget
   stay unchanged except for necessary compatibility fixes.
2. **Speed & token efficiency.** Extension load cost, YAML parse cost, and widget
   / validation message size are first-class metrics.
3. **Explicit design boundaries.** Keep `validation ↔ state ↔ render ↔
   auto-advance` and the `extensions/` Pi API wiring separable and documented.
4. **`pi-extension-template` compliance.** Track and close gaps against the
   upstream template (see checklist below).
5. **Public quality.** README, CHANGELOG, SECURITY, CI, `npm pack`, and the
   auto-release → publish handoff must stay publishable and trustworthy.

### Operating constraints

- **Human-owned actions** (unchanged by any AI task): repository secrets, npm
  publishing credentials, permission changes, production actions. AI tasks only
  prepare and verify (version bump + CHANGELOG + `npm run ci`); humans and the
  automation pipeline gate the actual publish.
- **Human-mediated core, preserved.** No system-prompt injection for skill
  execution and no automatic skill invocation. Auto-advance changes playbook
  state only; it never executes a skill.
- **Seed sizing.** Every actionable item below is intended as a 30–90 minute,
  independently verifiable change with an explicit version-bump classification.

## Change classification (SemVer for this package)

| Bump | Applies to |
| --- | --- |
| `patch` | bug fixes, CI/template compliance, doc/README alignment, test hardening, non-behavioral refactors |
| `minor` | backward-compatible improvements: perf/token-efficiency, stricter validation, new optional config, additional sample playbooks |
| `major` | breaking changes to a command name, the YAML schema, the run-state file location, or widget output shape — **avoid unless required**; always human-approved |

---

## Phase 1 — Month 1: Stabilization & public quality

**Goal:** make the current surface fully self-consistent and publishable with no
known compliance gaps.

| # | Item | Type | Bump | Acceptance |
| --- | --- | --- | --- | --- |
| 1.1 | Pin **all** GitHub Actions to immutable SHAs. Today every workflow floats a tag: `ci.yml` uses `actions/checkout@v6` + `actions/setup-node@v4`; `auto-release.yml` and `publish.yml` use `@v4`. | compliance | none (CI-only) | `grep -R "uses: actions/" .github` shows only SHA-pinned refs; CI stays green. |
| 1.2 | Close the `pi-extension-template` compliance checklist (section below); record every intentional deviation in this file. | compliance | none (docs) | Checklist section carries status + rationale; deviations are explicit. |
| 1.3 | README alignment: assert the seven documented commands (`/playbook:list`, `/playbook:start`, `/playbook:resume`, `/playbook:status`, `/playbook:done`, `/playbook:choose`, `/playbook:cancel`) and the YAML structure / `autoAdvance` modes match the code in `extensions/index.ts` and `src/validation.ts`. | docs | none (test+docs) | A smoke test extracts command tokens from `extensions/index.ts` and compares them to README; drift fails CI. (Carries the standing **README alignment** backlog task.) |
| 1.4 | `npm pack` contents audit: `files` currently ships `extensions/`, `src/`, `docs/`, `samples/`, `LICENSE`, `README.md` — but **not** `CHANGELOG.md` or `SECURITY.md`. Decide and align with the template (ship both). | quality | patch | `npm run validate:package` output is the expected manifest; `CHANGELOG.md` + `SECURITY.md` are intentionally included or excluded with a recorded reason. |
| 1.5 | Add a `version:check` PR guard (`scripts/check-version-bump.mjs`) so a PR touching `src/` or `extensions/` must bump `package.json` version and add a `CHANGELOG.md` entry. | quality | none (build infra) | Guard runs in `ci.yml`; a code-only PR without a bump fails CI. |

## Phase 2 — Month 2: Performance, token efficiency & design boundaries

**Goal:** reduce load cost and output size without changing the user-facing contract.

| # | Item | Type | Bump | Acceptance |
| --- | --- | --- | --- | --- |
| 2.1 | Token-efficiency pass on widget + validation messages (`src/render.ts`, `src/validation.ts`, `src/auto-advance.ts`). Trim redundant guidance and standardize wording. | perf | minor | Representative runs render measurably shorter output; snapshot tests pin the new shape. |
| 2.2 | Cold-start audit: ensure no YAML parse or file I/O happens at extension registration; defer all playbook loading until the first `playbook:*` command. | perf | minor | A startup benchmark is added; the registration path does no I/O. |
| 2.3 | Document design boundaries (`validation ↔ state ↔ render ↔ auto-advance` + `extensions/` wiring). Consolidate `AGENTS.md`, `CONTEXT.md`, and `docs/adr/` into a single boundary reference. | design | none (docs) | Each layer's responsibility is written down; refactor optional and UX-neutral. |
| 2.4 | Validation strictness review (`src/validation.ts`): confirm transitions, outcome targets, skill references, and `entry`/`complete` semantics reject malformed playbooks with clear messages. | quality | minor | A corpus of invalid-playbook → expected-error cases is added as tests. |

## Phase 3 — Month 3: Validation depth & run-state resilience

**Goal:** make auto-advance, selection, and run-state files predictable under edge cases.

| # | Item | Type | Bump | Acceptance |
| --- | --- | --- | --- | --- |
| 3.1 | Auto-advance marker edge cases (`src/auto-advance.ts`): single vs multi outcome, markerless completion (suggest-only), outcome marker without skill invocation (warn + ignore), visible-marker retention. | stabilization | minor | Each edge case is covered by a focused test; no state change without a valid signal. |
| 3.2 | Selection-UI resilience (`extensions/index.ts`): no-TUI fallback messages, empty playbook list, no active runs, and single-option fast paths are consistent and non-blocking. | stabilization | patch | Every selection path has a deterministic, tested message. |
| 3.3 | Sample playbook coverage: add a second canonical sample (e.g. a multi-branch review flow) and extend validation tests across both samples. | coverage | minor | Two samples ship and both pass the full validation suite. |
| 3.4 | Run-state file resilience (`src/state.ts`): define behavior for corrupt or partial `.pi/playbook-runs/*.json` (reject + clear warning, never crash). | stabilization | patch | Malformed run-state files are handled gracefully with a tested message. |

---

## Playbook feature priorities

The existing surface (built, not to be expanded on this roadmap):

1. **Playbook-driven workflows** — ordered skill steps with named outcomes and
   transitions, defined in YAML. Keep the schema stable.
2. **Human-mediated steps** — every step needs an explicit user action. No hidden
   automation, no skill execution by the extension.
3. **Marker-based auto advance** — single-outcome steps advance on a visible
   `PLAYBOOK_OUTCOME:` marker; multi-outcome steps always require explicit choice.
   Refinements are edge-case correctness only (Phase 3.1).
4. **Active-run widget** — current step, skill command, completion criteria,
   outcome labels. Refinements are output length only (Phase 2.1).
5. **Strict YAML validation** — structural, transition, and skill-reference checks
   on load. Refinements are strictness + messages (Phase 2.4).
6. **Selection UI** — argument-free commands using the Pi TUI selector.
   Refinements are resilience (Phase 3.2).
7. **Local run state** — `.pi/playbook-runs/` inside the target project, never in
   git. Refinements are file resilience (Phase 3.4).

> **Not on this roadmap:** new commands, auto-driving skills, system-prompt
> injection for skill execution, or moving run state out of the target project.
> New features require a separate, human-approved feature issue.

## Testing strategy for playbook workflows

- **Runner:** Node.js built-in test runner (`node --test`) executed through `tsx`
  (`npm test`); TypeScript strict mode checked with `tsc --noEmit` (`npm run check`).
- **Layer coverage:** pure functions are tested per layer — `validation.test.ts`
  (schema/transitions/skills), `state.test.ts` (run lifecycle + transitions),
  `render.test.ts` (widget output), `auto-advance.test.ts` (marker/advance logic),
  `selection-ui.test.ts` (selection + fallback messages).
- **Gate:** `npm run ci` = typecheck + tests + `npm pack --dry-run`; this is the
  single PR gate and must stay green.
- **Direction:** Phase 2.4 adds an invalid-playbook corpus; Phase 3.1 adds
  auto-advance edge cases; Phase 3.4 adds run-state corruption cases. The goal is
  that every rejection path (validation, advance, selection, state) has a test
  pinning its user-facing message.

---

## `pi-extension-template` compliance checklist

Current status as of v1.0.1. Deviations are tracked here so they are intentional.

| Item | Status | Note |
| --- | --- | --- |
| `pi.extensions` declared in `package.json` | ✅ done | `["./extensions/index.ts"]` |
| `pi-package` keyword for discoverability | ✅ done | — |
| `publishConfig.access = "public"` | ✅ done | — |
| Combined `check` (typecheck + test + pack:dry) | ⚠️ partial | `npm run check` is typecheck-only; the combined gate is `npm run ci`. Consider aliasing `check` → `ci`. |
| `version:check` PR guard | ❌ gap | no `scripts/` today → Phase 1.5 |
| CI validates PRs + `main` | ✅ done | `.github/workflows/ci.yml` on `push` + `pull_request` |
| Auto-release → publish handoff | ✅ done | `auto-release.yml` → `publish.yml` |
| npm provenance (`id-token: write`) | ✅ done | `publish.yml` |
| Keep a Changelog + SemVer | ✅ done | `CHANGELOG.md` |
| `SECURITY.md` + reporting policy | ✅ done | added in v1.0.1 |
| **GitHub Actions pinned to immutable SHAs** | ❌ gap | all workflows float `@v*` → Phase 1.1 |
| README ↔ registered commands drift guard | ❌ gap | to add in Phase 1.3 |
| `npm pack` manifest ships CHANGELOG + SECURITY | ❌ gap | both missing from `files` → Phase 1.4 |

## Backlog integration

The standing **README alignment** backlog task is folded into Phase 1.3, backed by
a smoke test so it cannot regress. Any future backlog item must be mapped to a
phase here — or explicitly deferred — before it is worked, so this file remains the
single source of intent.

---

## Candidate maintenance seeds (import-ready)

The phase items above are the candidate maintenance seeds. Each is a 30–90 minute,
independently verifiable change. They are intended to be split into local issue
files at `4_Project/OSS/pi-skill-playbook/Issues/<slug>.md` for the Local Issue
Importer, using the default frontmatter below plus the per-seed overrides in the
table.

**Default seed frontmatter** (applies to every seed unless overridden):

```yaml
ready_for_multica: true
status: ready
project_key: pi-skill-playbook
issue_type: maintenance
source_roadmap: 4_Project/OSS/pi-skill-playbook/ROADMAP.md
sequence_total: 12
pr_required: true
pr_allowed: true
release_allowed: false
production_allowed: false
work_owner: ai
route_mode: direct
```

**Per-seed overrides** (`sequence_index`, `blocked_by`, `unblocks`,
`version_bump_required`, `version_bump_type`, `version_bump_reason`,
`package_publish_expected`):

| Slug | Phase | Bump | Publish | Blocked by | Unblocks |
| --- | --- | --- | --- | --- | --- |
| `01-ci-actions-sha-pinning` | 1.1 | none | no | — | `02-version-check-pr-guard` |
| `02-version-check-pr-guard` | 1.5 | none | no | `01-ci-actions-sha-pinning` | — |
| `03-npm-pack-contents-fix` | 1.4 | patch | yes | — | — |
| `04-readme-command-drift-guard` | 1.3 | none | no | — | — |
| `05-token-efficiency-render-output` | 2.1 | minor | yes | — | — |
| `06-cold-start-lazy-load` | 2.2 | minor | yes | — | — |
| `07-design-boundaries-doc-consolidation` | 2.3 | none | no | — | — |
| `08-validation-strictness-corpus` | 2.4 | minor | yes | — | — |
| `09-auto-advance-marker-edge-cases` | 3.1 | minor | yes | — | — |
| `10-selection-ui-resilience` | 3.2 | patch | yes | — | — |
| `11-sample-playbook-coverage` | 3.3 | minor | yes | — | — |
| `12-run-state-file-resilience` | 3.4 | patch | yes | — | — |

Seeds that publish (`03`, `05`, `06`, `08`, `09`, `10`, `11`, `12`) bump version +
`CHANGELOG.md` and pass `npm run ci` in the PR; the human/automation-owned
`auto-release` → `publish` pipeline performs the actual npm publish. No seed on
this roadmap needs a human decision before implementation, so all carry
`ready_for_multica: true`.

---

This roadmap is a living document. Update it (and bump `CHANGELOG.md`) whenever a
phase item is completed, a compliance status changes, or direction shifts.
