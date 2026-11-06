# Pi SDK 1.5.0 compatibility

This package is verified with `@earendil-works/pi-agent-core`, `pi-ai`,
`pi-coding-agent`, and `pi-tui` pinned to `1.5.0` for development and tests.
The published peer dependency on `pi-coding-agent` remains `*`; SDK pins are
not runtime dependency or peer-range changes. The package patch version is
`1.5.13`. The shared migration findings and runtime smoke contract were
independently verified in the merged
[pi-extension-template baseline PR #141](https://github.com/eiei114/pi-extension-template/pull/141).

## 1.5.0 API compatibility findings

Pi 1.5.0 moves tool-argument validation to `@earendil-works/pi-schema`.
TypeBox schemas remain JSON Schema, but non-JSON-Schema features such as
`Type.Refine()`, `Type.BigInt()`, `Type.Undefined()`, `Type.Void()`, codecs,
and `Format.Set()` no longer validate tool arguments; constraints using those
features belong in `execute()`. Validation also coerces loosely typed values
before checking them and reports pi-schema validation messages. This package
does not register tools or define tool-argument schemas, so no migration is
needed.

The published `pi-ai` no longer re-exports TypeBox, and its `StringEnum` type
is a pi-schema `Schema<T>`, not a TypeBox schema. This package imports only
`AssistantMessageEvent` from `pi-ai` and does not use `StringEnum` or TypeBox
through that package, so those typing changes do not require code changes.
`pi-coding-agent` 1.5.0 pins `typebox` to `1.3.27`; keep the lockfile's resolved
version rather than introducing a second newer TypeBox copy.

The earlier `modelRegistry.streamSimple()` migration remains applicable: the
import-web draft path uses the active registry instead of the old global
`streamSimple` compatibility export, so authentication and headers come from
the host. The Pi 1.2.0 `before_agent_start` change also remains applicable:
`messageType` is a union, and only `user` events have `prompt`/`images`; custom
events have `message` and no `prompt`. This handler reads only the shared
`systemPrompt`. It does not access `ctx.isIdle()` or call `sendUserMessage()`
during startup, when the session is busy and a send requires `deliverAs`.
The 1.5.0 baseline documentation and release notes were reviewed for deprecated
APIs; no additional deprecated SDK call sites exist in this extension.

## Functional verification boundary

`npm run smoke:pi` and `npm run ci` run the CLI installed from the pinned local
Pi SDK, not a global Pi installation. The smoke starts actual Pi RPC processes
with an isolated temporary project and Pi agent directory and checks five
cases: extension registration, import-web draft creation, a handled empty-input
error, a second-process history response and clean shutdown, and the native
host-shell version. The happy path uses Pi's actual `modelRegistry.streamSimple()`
with the SDK's deterministic in-memory faux provider; no remote or paid
inference occurs. The actual Pi host, extension loader/lifecycle, RPC dispatch,
and feature handlers are not mocked. Only the project, source HTTP response,
skill, and provider response fixtures are isolated test data. The Windows
host-shell check invokes the locally pinned CLI through native PowerShell.

The curated observations are stored in
`docs/verification/pi-sdk-smoke.json`. CI executes the behavioral smoke itself;
it does not merely validate the report JSON.
