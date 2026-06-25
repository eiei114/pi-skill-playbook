# Changelog

## 1.1.0

- Added Pi OSS lane sample playbooks: `pi-oss-new.yml`, `pi-oss-bootstrap-only.yml`, and `oss-maintenance-onboard.yml`.
- Documented when to use generic vs Pi OSS samples in README and expanded `docs/examples.md` with copy-and-start steps.
- Added `tests/samples.test.ts` to validate packaged samples against the strict schema and vault skill names.

## 1.0.1

- Added root `SECURITY.md` with vulnerability reporting instructions.
- Linked README Security section to `SECURITY.md`.

## 1.0.0

### Breaking changes

- Removed legacy `/playbook <subcommand>` space-dispatch. Use colon commands only (`/playbook:list`, `/playbook:start`, etc.).
- Removed explicit-argument forms (`/playbook:start <id>`, `/playbook:resume <run-id>`, `/playbook:choose <outcome>`, `/playbook:cancel <run-id>`). All subcommands are argument-free and use the Pi TUI selection UI on the happy path.
- Removed tab-completion for playbook IDs, run IDs, outcomes, and `--run` flags.

### Changed

- `playbook:*` commands are now the sole registered command surface.
- Auto-advance suggestion messages point to `/playbook:choose` without embedding outcome names.

## 0.1.5

- Rewrote README to align with the Pi OSS minimal-docs policy.
  - Added badges (CI, Publish, npm version, npm downloads, License, Pi package).
  - Added durable sections: What this is, Features, Install, Quick start, Usage summary, Package contents, Development, Release, Security, Links, License.
  - Documented all seven commands with a summary table.
  - Added Playbook YAML structure reference with auto advance modes.
  - No changes to runtime code.

## 0.1.4

- Initial public release.
