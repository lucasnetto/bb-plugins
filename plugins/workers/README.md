# Workers

View child workers inside their parent's right panel, including hidden threads.
Open **Workers** from the thread panel's Actions menu, or **Open workers** in the
command palette. Use the compact worker picker to read its live conversation, reply, resolve
an interaction, or stop it using BB's native compact chat.

The compact picker shows worker titles and statuses. Model and reasoning details
appear below it. The panel does not change sidebar visibility or archive state.

Workers are direct children of the current thread (across projects/providers).
Archived and unarchived children appear together. The picker opens the first
worker automatically and leaves the rest of the panel for chat. Workers are
paginated in groups of 25;
lifecycle events refresh immediately, with a ten-second fallback while mounted.
Idle means the thread is idle; it does not imply the task succeeded.

Agents delegate with `bb_worker_thread({ title, prompt })`. The tool fixes the
parent to the calling thread, reuses its project and environment, inherits its
permission mode, and always creates a hidden worker. Omitting `preset` snapshots
its immediate parent's resolved provider, model, and thinking level. Raw execution
overrides are not accepted. The result contains the worker's `threadId`, preset
name (or null for inheritance), and resolved execution settings; the spawn also
records that snapshot in Workers thread metadata.

## Convert a sidebar thread

`bb_convert_to_worker({ threadId })` hides an existing direct child without
restarting it or changing its conversation, execution settings, or archive state.
The caller is taken from BB's tool context; no caller/parent override is accepted.
The thread remains accessible in its parent's Workers panel.

The plugin persistently records each thread's parent on `thread.created` and
requires both that original parent and its current parent to be the caller.
Self-conversion, unrelated threads, grandchildren, deleted threads, and ownership
claimed by reparenting are rejected. Already-hidden eligible children are a no-op.
Older threads, or threads created while this plugin was disabled, lack verified
creation ownership and cannot be converted. This is a plugin-tool restriction,
not a global access-control rule for BB's independent thread-update APIs.

## Worker presets

Open **Settings → Workers → Worker presets** to optionally configure names,
short descriptions (when an agent should use each), and provider/model/thinking
combinations through BB's native picker. Presets are stored separately in each
BB profile; there are no built-in presets. Save explicitly to apply edits.

With no presets, agents see only `title` and `prompt`. Otherwise the tool adds
an optional `preset` enum with the configured names and descriptions. Omission
always inherits; `inherit` is reserved and cannot be a preset name. Names are
lowercase letters, digits, and hyphens (up to 64 characters); descriptions are
required and capped at 300 characters, with up to 20 presets.

New or changed presets are validated against the current profile's primary-host
catalog at save time, and selected presets are revalidated in the parent's
execution environment before spawning. Removed or unavailable presets fail
explicitly—no model substitution. Removing stale presets remains possible even
when their provider is offline. Concurrent settings edits fail rather than
silently overwriting another window; reload saved presets before retrying.

Tool schema updates apply when BB next starts/resumes the agent session, not
mid-session. Existing workers retain their spawn settings; subsequent explicit
user changes to a worker affect what its own children inherit.

This plugin uses the public SDK, including the host-owned `ThreadChat`. It does
not copy transcripts or change worker permissions. It adds no navigation page
and creates workers only when an agent calls the tool.

```sh
vp test --project workers
vp check plugins/workers
bb plugin build plugins/workers
bb plugin install path:. --plugin workers
bb plugin reload workers
```

## Agent delegation

The plugin bundles the [bb-workers skill](skills/bb-workers/SKILL.md). Ask an
agent to “use bb workers” or invoke `$bb-workers` to use
hidden child threads as persistent, messageable subagents. The skill explains
spawning and communication without prescribing how agents divide or manage work.
Agents decide when delegation is useful. Model choices are limited to
inheritance and the worker presets configured in this BB profile.
New agent sessions discover the skill after the plugin is refreshed.

## Fusion mode

Invoke `$fusion <task>` or explicitly ask for Fusion mode to use the bundled
[Fusion skill](skills/fusion/SKILL.md). The current thread stays the lead for
planning, ambiguous decisions, review, and user communication. One persistent
sidekick implements and tests bounded assignments, receives corrections in the
same conversation, and hands difficult decisions back to the lead.
The lead invokes `bb_worker_thread` itself with an explicit preset and reuses
the returned thread for follow-ups; the user does not need to launch a worker
or include a preset name when a suitable configured preset is available.

Configure an implementation preset in **Settings → Workers → Worker presets**
first, then start or resume the agent session so its tool sees that preset.
For example, name a preset `fusion-worker`, describe it as “Fusion sidekick for
bounded implementation and tests,” and choose your preferred provider, model,
and thinking level. The name is only an example; Fusion honors explicit preset
choices and otherwise uses the advertised descriptions. It does not create
presets or silently inherit the lead's model when configuration is missing.

Fusion coordinates edits in the shared checkout and stops the sidekick after
completion while retaining its history. It adds no automatic routing, cache
keepalives, or claimed cost savings. Ordinary worker delegation stays unchanged.
