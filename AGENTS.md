# AGENTS.md

## Project

This repo implements **Pi Skill Playbook**, a Pi package-ready TypeScript extension.

## Domain boundaries

- Playbook owns passive guidance for Agent Skill usage flows.
- Shiori owns skill discovery/catalog help; do not merge responsibilities here.
- Takt Bridge owns TAKT execution; do not add auto-driving workflow execution here.
- MVP must remain human-mediated: no system prompt injection and no automatic skill invocation.

## Coding standards

- TypeScript strict mode.
- Keep domain logic in `src/` and Pi API wiring in `extensions/`.
- Prefer pure functions for validation and state transitions.
- Runtime state belongs under `.pi/playbook-runs/` in the target project, not in git-tracked files.
- Do not automatically edit a target repo's `.gitignore`; warn with a snippet instead.
