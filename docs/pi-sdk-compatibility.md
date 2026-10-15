# Pi SDK 1.2.0 compatibility

This package is verified with `@earendil-works/pi-agent-core`, `pi-ai`,
`pi-coding-agent`, and `pi-tui` pinned to `1.2.0` for development and tests.
The published peer dependency on `pi-coding-agent` remains `*`; the SDK pins
are not runtime dependency or peer-range changes. The compatibility baseline
and shared smoke contract are documented in the merged
[pi-extension-template baseline PR #131](https://github.com/eiei114/pi-extension-template/pull/131).

## API compatibility finding

The extension uses `ExtensionAPI.registerCommand`, `getCommands`, session/input
events, and the extension UI notification API. The import-web draft path now
uses `ctx.modelRegistry.streamSimple()`, the documented provider-neutral nested
model API, instead of importing the old global `streamSimple` function from
`pi-ai`. The SDK resolves request-time authentication and headers through the
active registry. This removes the local auth/header mirror and avoids coupling
to deprecated `pi-ai` compatibility exports. The [Pi 1.2.0 release notes](https://github.com/earendil-works/pi/releases/tag/v1.2.0) change
`before_agent_start` events to a `messageType` union: user events contain
`prompt`/`images`, while custom events contain `message` and no `prompt`.
Handlers that read user-only fields must first check
`event.messageType === "user"`. This extension's handler only reads the shared
`systemPrompt`, so no event migration is needed. It also does not call
`ctx.isIdle()` or `sendUserMessage()` during startup, when the session is busy
and sends require an explicit `deliverAs` value. Review of the pinned upstream
extension and `pi-ai` API documentation found no other deprecated call sites.

## Functional verification boundary

`npm run smoke:pi` and `npm run ci` run the pinned local Pi CLI, not a global Pi
installation. The smoke loads the real extension in RPC mode with an isolated
temporary project and Pi agent directory, then checks command registration, an
import-web draft, the handled empty-input error, a second-process history reload
and shutdown, and the native host-shell version. The import-web happy path uses
Pi's actual `modelRegistry.streamSimple()` against the SDK's deterministic
in-memory faux provider; it makes no remote or paid inference. The harness also
rejects main-agent-start events. The Pi host, extension loader/lifecycle, RPC
dispatch, and feature handlers are real; only the project, HTTP source, skill,
and provider response fixtures are generated in isolated temporary directories.
The Windows smoke invokes the locally pinned CLI through native PowerShell. Its
observations are committed in `docs/verification/pi-sdk-smoke.json`, and CI runs
the behavior harness itself rather than only validating that report.
