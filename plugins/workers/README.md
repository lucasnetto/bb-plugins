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
permission mode, and always creates a hidden worker. Optional `providerId`,
`model`, and `reasoningLevel` select execution options; otherwise BB defaults
apply. The result contains the worker's `threadId` for follow-up commands.

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
agent to “use bb workers,” “delegate to Fable,” or invoke `$bb-workers` to use
hidden child threads as persistent, messageable subagents. The skill explains
spawning and communication without prescribing how agents divide or manage work.
It does not turn on delegation for ordinary coding requests. Model preferences
come from your request, project instructions, or BB defaults, not a fixed model
in the skill.
New agent sessions discover the skill after the plugin is refreshed.
