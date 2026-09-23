# Cursor SDK

The **Cursor SDK** provider runs locally or on Cursor Cloud using the profile's
existing Cursor API key. Use the **cloud** switch in the New thread composer with Cursor SDK selected,
or use **Cloud agents** in the
plugin settings. Both update the same persisted setting for this BB instance.
The switch defaults to off (local) and applies to new conversations;
existing threads keep their original runtime, even after a restart.

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
available. Text follow-ups steer a running local agent through `run.steer()`.
The bridge acknowledges receipt immediately and tracks delivery separately, so
steering during a long-running tool does not time out BB's request. Delivery
errors are reported without failing the active turn or resending uncertain input.
When Cursor declines live delivery, the bridge sends the message once the current
SDK run ends, retaining the same BB turn. Cloud runs, attachments, and changed
execution settings use this follow-up path. Stopping the turn discards follow-ups
that the SDK has not yet accepted.

BB's slash-command picker discovers skills in `.cursor/skills`, `.agents/skills`,
`.claude/skills`, and `.codex/skills` under the workspace host's home directory
and the project (including ancestor directories). Nested skill folders are
included, matching the ACP Cursor provider. Discovery does not upload local
skill files to Cursor Cloud.

The runtime can also be installed through Settings → Providers. Each host needs
Node.js 22.13+ and npm. Exactly `@cursor/sdk@1.0.31` is installed in the plugin's
provider bridge data directory, including the platform package. The published SDK loads
adjacent files and native helpers, so it stays intact rather than embedded in
BB's single-file host artifact. No BB core changes or global npm installs.

## Cursor Cloud

Select **Cursor SDK** in a new thread, then turn on **cloud** in the composer. You can also set it from the CLI:

```sh
bb plugin config cursor-sdk set cloudAgents true
# Use local execution for subsequent new threads:
bb plugin config cursor-sdk set cloudAgents false
```

This is an instance-wide default for new Cursor SDK conversations, not a
per-message switch. Open windows receive changes immediately and reload the
setting after reconnecting. The control appears beside Send in expanded
composers and above the input in compact layout, only with Cursor SDK selected.
The SDK does not expose the selected provider, so plugin CSS checks the native
model-picker title within the composer. If BB changes that markup, the control
stays hidden; settings and CLI remain available. Sending is locked while this
control saves.

A cloud conversation cannot be moved into a local SDK
conversation, or vice versa. BB's current plugin API does not expose custom
per-thread toggles beside the model picker.

Start from a clean Git checkout with a
GitHub `origin` and push the starting commit first. The provider pins that commit
and asks Cursor to work on an isolated remote branch. Your Cursor account must
have Cloud agents and access to that GitHub repository. Automatic PR creation is
off; the agent can still create a PR when you request one.

Cloud uses the same model, reasoning, speed, and plan controls. BB streams the
remote replies and tools, and shows the agent link plus branch/PR links returned
by Cursor. Changes stay in the remote branch; fetch and review them locally when
ready. Local BB tools, CLI access, and environment variables are not forwarded.
Configure remote credentials/MCP in Cursor. Images are supported; local file
attachments must be pasted as text or committed to the repository.

Stop cancels the remote run. Releasing the session or shutting down BB detaches
and leaves cloud work running. Resume uses the same cloud agent and pinned
repository, even if the local checkout has changed. If that agent is still
running after reconnect, BB shows its Cursor link: wait for completion there,
then retry the follow-up. This version does not replay output missed while BB
was disconnected. A missing or archived agent produces an actionable error;
it never silently replaces established conversation history.

Cloud launch records under `cloud-sessions/<profile>` contain the BB thread ID,
repository, commit, and launch state, with no credentials. Keep these records to
recover a first launch interrupted before Cursor created the remote agent.
Cloud cannot enforce BB tool denylists or replace Cursor's system prompt; those
policies are rejected. Full access is required.

## Accounts and storage

The instance data directory selects Personal (`.bb`) or Work (`.bb-work`). On
macOS, the same Keychain service and account as the ACP launcher are used:
`bb.cursor.personal.api-key` / `lucas-personal` or
`bb.cursor.work.api-key` / `lucas-work`. On Linux the plugin reads
`~/.config/orbisa/cursor-<profile>-api-key`. It never falls back to another
profile or ambient Cursor login.

SDK JSONL stores live under `conversations/<profile>/sessions/<uuid>` in plugin bridge storage.
BB persists the Cursor agent ID and resumes it after releasing or restarting
a session. Atomic, validated entries in `locations/` map native agent IDs to
their directories. Keep this storage on the same host to retain its checkpoints.
New conversations and forks get independent stores and I/O locks. Existing
conversations migrate on resume under their original exclusive agent lease.
Migration copies checkpoint bytes, agent metadata, runs and ordered event payloads
before publishing the new location. The legacy files remain untouched as a backup;
event offsets/timestamps in the new copy are regenerated by the public store API.
A damaged published store never silently falls back to an older legacy checkpoint.
When a thread's working directory changes, the next local resume updates its saved
workspace under the agent lease, preserving its identity, checkpoints and run history.

## Session recovery

Completed local sessions keep their process warm for one minute, then release it
to reclaim the SDK runtime's memory. The next message starts a fresh process and
resumes the same saved conversation, workspace, and tools. Quick follow-ups reuse
the warm process; active turns, pending requests, and host tool callbacks prevent
idle retirement. Replacement waits for the old process to finish disposal and
exit. Cloud sessions retain their existing lifecycle. Resuming after the idle
timeout adds SDK startup/checkpoint loading latency.

Local sessions claim exclusive ownership of their Cursor agent. If the owning
process dies, the next resume can reclaim it and use the SDK's `local.force`
option on its first send to expire the abandoned run while retaining the saved
conversation. A live owner blocks recovery; elapsed time alone never makes a
run eligible. Cloud runs do not use this recovery path.

Each conversation's JSONL files are coordinated across session processes through
`coordination.sqlite` beside its store. The profile-level agent lease remains
compatible with older processes and protects migration. Keep stores on local disk. Terminal
run states cannot be overwritten by stale checkpoint writes. Stop and release
share pending cancellation, verify its persisted state, and finish disposal
before acknowledging success. Graceful process shutdown waits for cleanup;
forced termination leaves ownership records for the next resume to reclaim.

The parent process retains the session's resume parameters. After a child crash,
the next user message first restores the same agent, workspace, and tools. Failed
local turns retire their SDK process so later messages do not reuse a broken
runtime. Replacement waits for the old process to exit; the failed prompt is
never automatically replayed. This in-memory recovery record lasts for the
parent's lifetime; after a full bridge restart, BB supplies its persisted identity
through the normal resume request.

Local Stop allows ten seconds for graceful cancellation, then terminates the
session process with a further five-second shutdown limit. A forced Stop is
acknowledged only after process exit. Its persisted run may still need expiry on
the next resume. Cloud cancellation never uses this local termination shortcut.
Pending host tool calls are resolved before SDK cancellation, and late tool calls
from ended runs are rejected. Once a run finishes, steering acknowledgement gets
five seconds to settle; uncertain delivery is reported without resending it.

BB opens the turn before waiting for the SDK's run handle, so slow model startup
is shown as an active turn rather than an accepted-but-not-started timeout. This
does not speed up Cursor or retry a stalled network request. Errors include their
actual message and request ID when available.

For missing or corrupt checkpoints, recover BB's saved conversation into a fresh
thread without changing the original:

```sh
bb cursor-sdk recover <thread-id> --preview --json
bb cursor-sdk recover <thread-id> --json
bb cursor-sdk diagnostics <thread-id> --json
```

Recovery requires an idle/failed source with no queued messages or active
background agents. It reuses the BB environment and saved model/reasoning/speed
selection. The fresh thread uses the current Cloud agents default. The initial
prompt requests a recovery summary and waits for your next instruction.
The context includes the original request (up to 8,000 characters) and recent
user/assistant messages (up to 80,000 characters or 3,000 events), with explicit
truncation and attachment references. Native checkpoint state, attachment contents,
tool state, and Cloud-side files are not reconstructed. Repeated requests for
unchanged history return the same recovered thread. An uncertain creation is not
automatically retried; `--new` deliberately requests another recovery.

Initialization has phase-specific deadlines: process/SDK/credential loading 30s,
model discovery 15s, checkpoint migration/fork 120s, native create/resume 90s, and
run-handle creation 120s. A blocked local child is terminated before replacement;
there is a further 5s shutdown limit. The run-start deadline pauses during host
tool callbacks and ends once the run handle arrives. Streaming and tool execution
have no silence-based watchdog. Cloud process termination reports uncertain
remote execution and never claims cancellation.

Diagnostics retain the last 80 phase transitions per thread with durations and
outcomes. They are read from the thread's host through BB's public installation
descriptor and host RPC, and contain no prompts, tool payloads, credentials, or
raw SDK errors. The installed runtime is required to locate that storage.

The model cache now includes validated native model IDs, parameters, aliases, and
variants. It is partitioned by SDK version, profile, and credential digest. A
saved catalog up to seven days old permits startup during discovery outages;
background refreshes have a 15s deadline. Selecting a model absent from the cache
forces discovery, and older/corrupt caches require a successful refresh.

## Behavior and limits

- Streams assistant text, thinking, tools, task milestones, and reported usage into BB's timeline.
  Final text is not duplicated. Token usage and context occupancy are not guessed.
- Discovers the account's model catalog. Thinking and speed use BB's reasoning
  controls and Fast mode toggle; context sizes stay in the model list. None turns
  thinking off, and other supported levels enable it with the selected effort.
  Models with only a thinking toggle offer None and High. Fast mode uses the
  available speed when a model has only one tier, matching Cursor ACP.
  The bridge resolves controls to an actual SDK variant on start, resume, and
  each turn. Saved preset IDs remain usable but stay out of the model list.
- Forwards BB dynamic tools through SDK custom tools, including questions and
  plugin tools. Local sessions explicitly load project, user, and plugin Cursor
  settings, including their MCP servers, on start, resume, and fork. MCP OAuth
  login must already exist in Cursor; the SDK does not open a login flow.
- Task events appear as bounded progress messages. Consecutive duplicates are
  suppressed, and task-only runs still display their final answer. Task events
  do not supply stable IDs, so they are not shown as separate background agents.
- SDK failures retain their error code, HTTP status, and request ID
  where provided. Authentication and rate-limit failures emit BB recovery hints;
  other failures retain their diagnostic category. The bridge does not replay a
  failed turn or retry an uncertain steer. SDK-native transport retries remain
  enabled. Terminal errors without HTTP status keep their code and an unknown
  category rather than inferring an action from the error message.
- Stop cancels the SDK run. Release closes its runtime without inventing a turn.
- Each thread runs its SDK session in a separate child process, so concurrent
  threads retain their own environment variables and tool callbacks. Release
  disposes that process; a crashed session does not stop other threads.
- Fork local threads from their latest saved conversation state. The child gets
  its own agent ID and checkpoint blobs, and uses its selected workspace, model,
  instructions, and tools. The source must be idle and have a saved checkpoint
  on the same host/profile. Forks stay local even when Cloud agents is enabled.
  Workspace files are managed by the selected BB environment, not copied by the
  conversation fork. Completed local turns now publish durable checkpoints, enabling
  BB message editing and forks from earlier messages. Editing resumes an independent
  conversation at the preceding checkpoint; it does not undo workspace file changes.
  Turns recorded before this support was installed have no BB checkpoint markers.
  Cloud forks/editing, manual compaction, and native archive/rename sync remain unsupported.
- Full access is the supported execution policy. SDK approvals are not equivalent
  to BB Accept edits or automatic approval policies, so those modes are not offered.
  Plan mode uses Cursor's native plan mode.

## Development

```sh
vp test --project cursor-sdk
vp check plugins/cursor-sdk
bb plugin build plugins/cursor-sdk
```

Tests cover the public bridge conformance suite, local fork identity and isolation,
checkpoint pagination, failure cleanup, resume, cancellation, custom
tool forwarding, model controls, event translation, Git source validation, cloud
launch recovery, remote identity retention, and detach versus cancellation.

The Personal installation was also exercised through BB with Composer 2.5:
streamed replies, release/reload with conversation recall, a BB plugin tool call,
and cancellation of a native shell command followed by a successful new turn.
Cursor Cloud was exercised on Personal with a pinned pushed commit: streamed
reply, release/resume with marker recall, remote shell tool streaming, and Stop
confirmed as `cancelled` by Cursor's API, followed by a successful new turn.
The unified provider toggle was also tested live: a new `cursor-sdk` thread
launched on Cloud, then resumed with marker recall after the default was changed
back to local. Tests did not modify files or create PRs.
The composer switch was visually checked on Personal and toggled both ways;
CLI readback confirmed the saved default. Component tests cover cross-window
updates, reconnect reconciliation, and failed saves without changing the draft.

Design reference: [wyrd-company/ahp-cursor-sdk](https://github.com/wyrd-company/ahp-cursor-sdk).
This implements BB's native bridge directly, without an AHP dependency or copied
adapter source.

Reliability comparison: [pi-cursor-sdk findings and remaining limits](docs/reliability-review.md).

A live local fork check using Composer 2.5 confirmed that an independent child
recalls the source conversation. Run it explicitly with the Work profile key:

```sh
CURSOR_SDK_LIVE_FORK=1 vp test plugins/cursor-sdk/tests/server/fork.live.test.ts
```

This opt-in check sends two model requests and removes its temporary local store.

The crash/recovery check uses the Personal profile key, two Composer 2.5 requests,
and a temporary store. It kills only its own test child, recreates the legacy
store layout from that test's checkpoint, and makes model discovery fail. The next
message must migrate the store, restore the same agent, recall the preceding
conversation, and leave the legacy backup intact:

```sh
bb plugin build plugins/cursor-sdk
CURSOR_SDK_LIVE_RECOVERY=1 vp test plugins/cursor-sdk/tests/server/recovery.live.test.ts
```

Verify idle process disposal and checkpoint recall with two Personal Composer 2.5
requests in a temporary store (the test shortens the idle timeout):

```sh
bb plugin build plugins/cursor-sdk
CURSOR_SDK_LIVE_IDLE=1 vp test plugins/cursor-sdk/tests/server/idle.live.test.ts
```

Verify that editing excludes later conversation state with the Personal Cursor API key:

```sh
CURSOR_SDK_LIVE_REWIND=1 vp test plugins/cursor-sdk/tests/server/rewind.live.test.ts
```
