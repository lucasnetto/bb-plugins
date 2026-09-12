# Cursor SDK

A local Cursor provider for BB, offered alongside Cursor ACP as **Cursor SDK**.
It runs against the selected environment's working directory and uses the
profile's existing Cursor API key. Cloud agents are outside this version's scope.

## Install and use

```sh
vp install
bb plugin build plugins/cursor-sdk
bb plugin install path:. --plugin cursor-sdk
bb machine list --json
bb machine provider-cli install <host-id> cursor-sdk
```

Select **Cursor SDK** and a model in a new thread. Set reasoning and Fast mode
with BB's standard controls. The provider uses **Full access**.
Existing ACP threads retain their original provider and history. Plan mode is
available; follow-up messages queue while a turn runs.

The runtime can also be installed through Settings → Providers. Each host needs
Node.js 22.13+ and npm. Exactly `@cursor/sdk@1.0.31` is installed in the plugin's
provider bridge data directory, including the platform package. The published SDK loads
adjacent files and native helpers, so it stays intact rather than embedded in
BB's single-file host artifact. No BB core changes or global npm installs.

## Accounts and storage

The instance data directory selects Personal (`.bb`) or Work (`.bb-work`). On
macOS, the same Keychain service and account as the ACP launcher are used:
`bb.cursor.personal.api-key` / `lucas-personal` or
`bb.cursor.work.api-key` / `lucas-work`. On Linux the plugin reads
`~/.config/orbisa/cursor-<profile>-api-key`. It never falls back to another
profile or ambient Cursor login.

SDK JSONL stores live under `conversations/<profile>` in plugin bridge storage.
BB persists the Cursor agent ID and resumes it after releasing or restarting
a session. Keep that store on the same host to retain its checkpoints.

## Behavior and limits

- Streams assistant text, thinking, tools, and reported usage into BB's timeline.
  Final text is not duplicated. Token usage and context occupancy are not guessed.
- Discovers the account's model catalog. Thinking and speed use BB's reasoning
  controls and Fast mode toggle; context sizes stay in the model list. None turns
  thinking off, and other supported levels enable it with the selected effort.
  Models with only a thinking toggle offer None and High. Fast mode uses the
  available speed when a model has only one tier, matching Cursor ACP.
  The bridge resolves controls to an actual SDK variant on start, resume, and
  each turn. Saved preset IDs remain usable but stay out of the model list.
- Forwards BB dynamic tools through SDK custom tools, including questions and
  plugin tools. Cursor rules and MCP configuration use normal SDK loading.
- Stop cancels the SDK run. Release closes its runtime without inventing a turn.
  Fork, rewind, manual compaction, and native archive/rename sync are not advertised.
- Full access is the supported execution policy. SDK approvals are not equivalent
  to BB Accept edits or automatic approval policies, so those modes are not offered.
  Plan mode uses Cursor's native plan mode.

## Development

```sh
vp test --project cursor-sdk
vp check plugins/cursor-sdk
bb plugin build plugins/cursor-sdk
```

Tests cover the public bridge conformance suite, resume, cancellation, custom
tool forwarding, model presets, and event translation.

The Personal installation was also exercised through BB with Composer 2.5:
streamed replies, release/reload with conversation recall, a BB plugin tool call,
and cancellation of a native shell command followed by a successful new turn.

Design reference: [wyrd-company/ahp-cursor-sdk](https://github.com/wyrd-company/ahp-cursor-sdk).
This implements BB's native bridge directly, without an AHP dependency or copied
adapter source.
