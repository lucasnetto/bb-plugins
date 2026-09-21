---
name: cursor-sdk-recovery
description: Diagnose stalled Cursor SDK initialization or recover a broken Cursor SDK conversation into a fresh BB thread.
---

# Cursor SDK recovery

Use BB's normal resume first for a crashed local session with a valid checkpoint.
The plugin restores the saved agent on the next explicit message. It never
automatically replays a failed prompt.

Read startup diagnostics on the thread's own machine:

```sh
bb cursor-sdk diagnostics <thread-id> --json
```

This returns up to 80 phase records (process start, SDK load, credentials,
model discovery, checkpoint loading, create/resume/fork, run start, cleanup).
Records include timings and outcomes, without prompts, keys, or tool data.
The SDK runtime must be installed on that machine to locate its bridge storage.

When a native checkpoint is missing or corrupt, preview the saved BB context:

```sh
bb cursor-sdk recover <thread-id> --preview --json
```

When the user asks to recover that conversation, run:

```sh
bb cursor-sdk recover <thread-id> --json
```

The source must be an idle/failed Cursor SDK thread with no queued messages or
active background agents. This creates a visible child in the same environment,
preserves its model/reasoning/speed selection, and keeps the original intact.
New recovery threads use the current Cloud agents default. It sends the original
request and bounded recent user/assistant history, marks truncation, and keeps
attachment references. It does not restore attachment contents, native tool
state, or Cloud-side file changes. Its first prompt asks for a summary and to wait
for the user's next instruction, so failed commands are not automatically retried.

Repeated recovery of unchanged history returns the existing recovered thread.
If thread creation had an uncertain outcome, inspect the original's children.
Use `--new` only when the user wants another recovery; it deliberately bypasses
the saved receipt. It cannot be combined with `--preview`.

Report returned thread IDs as `@thread:<id>` links. Do not treat local process
termination as confirmation that remote Cursor Cloud work was cancelled.
