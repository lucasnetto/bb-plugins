# Cursor SDK reliability review

Reviewed `fitchmultz/pi-cursor-sdk` at
[`cac6254231733a317c94501d72a48d317cb873cc`](https://github.com/fitchmultz/pi-cursor-sdk/tree/cac6254231733a317c94501d72a48d317cb873cc)
on 2026-09-21 against this plugin and the pinned Cursor SDK 1.0.31 contract.
These are source findings and reproduced adapter failure cases, not a claim that
every reported production incident had the same cause.

## Findings applied here

| Reference pattern                                                    | Gap in BB's adapter                                                                                                                              | Change                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Invalidate unusable local agents; bound disposal for dead transports | Failed turns retained their SDK runtime. Cleanup could wait forever before publishing failure.                                                   | Bound failure cleanup, retire failed local processes, and restore the same saved agent on the next explicit message.            |
| Persist a resumable identity independently of the live agent         | A replacement child initialized its protocol but received `turn/start` without `thread/resume`.                                                  | Retain successful construction parameters and restore before dispatching new input. Do not replay the crashed turn.             |
| Cancel host tool requests before disposing the agent                 | Release awaited SDK cancellation before resolving BB callbacks, allowing a circular wait.                                                        | Resolve callbacks first, scope them to their turn, and reject calls from obsolete runs.                                         |
| Give cancellation and terminal outcomes explicit ownership           | Stop could remain pending forever while `agent.send()` or `run.cancel()` stalled.                                                                | Give local Stop a deadline; wait for OS-confirmed child exit before acknowledging forced termination or starting a replacement. |
| Surface terminal run errors separately from subsequent input         | A queued follow-up could continue after an SDK error and conceal it. Steering acknowledgement could also hold a completed run open indefinitely. | End failed runs visibly; bound acknowledgement waiting after completion and report uncertain delivery without retrying it.      |

Relevant reference files:

- [`cursor-session-agent.ts`](https://github.com/fitchmultz/pi-cursor-sdk/blob/cac6254231733a317c94501d72a48d317cb873cc/src/cursor-session-agent.ts): invalidation, bounded disposal, acquisition, and resume fallback.
- [`cursor-live-run-coordinator.ts`](https://github.com/fitchmultz/pi-cursor-sdk/blob/cac6254231733a317c94501d72a48d317cb873cc/src/cursor-live-run-coordinator.ts): terminal state and tool cancellation ownership.
- [`cursor-pi-tool-bridge-run.ts`](https://github.com/fitchmultz/pi-cursor-sdk/blob/cac6254231733a317c94501d72a48d317cb873cc/src/cursor-pi-tool-bridge-run.ts): pending host-tool lifecycle.

## Other useful patterns and limits

**Transcript reconstruction is the most valuable remaining recovery feature.**
The reference can bootstrap a fresh native agent from Pi's complete current
transcript when resume fails. BB's current provider-bridge construction schema
supplies an identity, workspace, options, and tools, but no historical transcript.
Silently creating a replacement would lose the conversation. This needs a
supported transcript handoff or an explicit plugin recovery workflow. The fixes
above preserve valid checkpoints; they cannot reconstruct missing or corrupt ones.
See [`cursor-session-send-policy.ts`](https://github.com/fitchmultz/pi-cursor-sdk/blob/cac6254231733a317c94501d72a48d317cb873cc/src/cursor-session-send-policy.ts).

**Per-session stores reduce contention and failure scope.** The reference uses a
separate SQLite store for each Pi session. BB currently uses a shared profile JSONL
store with cross-process coordination and per-agent ownership. Moving to isolated
stores is worth a separate migration that preserves existing identities, legacy
store lookup, and forks; changing the directory for new code alone would strand
old threads. See [`cursor-session-store.ts`](https://github.com/fitchmultz/pi-cursor-sdk/blob/cac6254231733a317c94501d72a48d317cb873cc/src/cursor-session-store.ts).

**SDK exceptions can escape the run promise.** The reference recognizes narrowly
identified Cursor abort, closed-writable, and transport errors at process scope.
BB already isolates each session in a child process. This change uses that boundary
to retire and restore failed runtimes, rather than suppressing uncaught exceptions
in a potentially damaged process. A crash can still end the current turn.
See [`cursor-sdk-process-error-guard.ts`](https://github.com/fitchmultz/pi-cursor-sdk/blob/cac6254231733a317c94501d72a48d317cb873cc/src/cursor-sdk-process-error-guard.ts).

**The MCP tool bridge has stronger cancellation semantics than SDK custom tools.**
The reference deliberately avoids `customTools` pending SDK cancellation/deadline
support. BB keeps its current tool API but now owns callback cancellation and
rejects late calls. Resolving a callback does not undo side effects of a tool
already executed by the host.

**First-send MCP initialization can look like a hung model.** The reference
shortens recognized MCP connect/list-tools waits from 60 to 10 seconds and extends
tool execution deadlines. It does this by replacing the process-wide `setTimeout`
and inspecting stack frames, because the SDK has no public per-server timeout
option. That is useful diagnostic evidence, but too dependent on SDK internals to
adopt without reproducing the exact startup failure. Local Stop is now bounded
even when that initialization never returns. See
[`cursor-mcp-timeout-override.ts`](https://github.com/fitchmultz/pi-cursor-sdk/blob/cac6254231733a317c94501d72a48d317cb873cc/src/cursor-mcp-timeout-override.ts).

**Transport configuration and catalog caching are useful follow-ups.** The
reference offers HTTP/1.1 for local agents and uses a cached native model catalog
at startup. BB caches the picker catalog but still fetches native models during
session construction. Network failures there can prevent resume before any prompt
is sent. These changes need focused transport evidence and cache validation rather
than an unconditional protocol switch or model guess.

## Verification

Regression coverage uses real child processes for crash/restore, failed-runtime
retirement, Stop deadlines, environment preservation, identity preservation, and
cloud isolation. Bridge fixtures cover cancellation waiting on host tools, late
tool rejection, stalled cancellation, uncertain steering, and errors with queued
follow-ups. Existing conformance, persistence, fork, model, and cloud tests remain
part of the plugin suite.

The opt-in live recovery check passed with Personal's Composer 2.5: after a
completed marker turn, an abrupt child exit was followed by a new message that
restored the identical agent ID and recalled the marker. The SDK emitted warnings
about ancillary Cursor cache/transcript paths denied by the test sandbox; the
plugin's temporary conversation store persisted and resumed successfully.
