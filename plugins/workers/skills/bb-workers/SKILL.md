---
name: bb-workers
description: Delegate work to hidden bb child threads and communicate with them like subagents.
disable-model-invocation: true
---

# BB workers

Workers are persistent subagents you can message. Use BB child threads instead
of native subagent tools so the user can follow them in the **Workers** panel.
Choose how to divide work, collaborate, and follow up as you would with your
own subagents. Workers can delegate too; no prescribed assignment or review
workflow is required.

## Spawn

Call `bb_worker_thread` with `title` and `prompt` (the task and relevant context).
It automatically creates a hidden child in your project and environment, with
your permission mode. By default it snapshots your provider, model, and thinking
level (also for nested workers). Save the returned `threadId` for follow-ups.

A new worker does not inherit this conversation, so give it the context it needs.
Include your thread ID in the prompt if it should message you directly.

Omit `preset` to inherit. If the user has configured worker presets in
**Settings → Workers**, the tool exposes their names and short descriptions
explaining when to use them. Select one by name only when appropriate; raw
`providerId`, `model`, and `reasoningLevel` overrides are not supported. With no
presets configured, the tool exposes only `title` and `prompt`.

Preset configuration belongs to the user and the current BB profile. Do not
edit it or bypass the tool to select another model. If a requested model is not
available through inheritance or an existing preset, explain that the user must
configure a preset. Unavailable presets fail explicitly rather than substituting
models. Settings changes appear when the agent session next starts/resumes.
Get your thread and environment IDs with `bb status --json`.

## Communicate

```sh
bb thread tell <worker-id> '<message>' --json  # steer or continue a worker
bb thread output <worker-id>                 # latest final response
bb thread show <worker-id> --json            # status and details
bb thread log <worker-id>                    # conversation and activity
bb thread wait <worker-id> --timeout 50       # wait when useful
bb thread stop <worker-id>                   # stop work / release runtime
```

`tell` works in either direction and between workers using their thread IDs.
Use `--mode queue` for a follow-up that should wait. A queued delivery is not a
failure; don't resend it. Child turns and blockers automatically report to the
parent, so you can keep working without polling. Reuse a worker for follow-ups;
stopping it preserves its conversation.

## Things to know

- Workers share your environment and files. Coordinate overlapping edits; this
  tool does not create isolated worktrees.
- Workers inherit parent permissions. Delegation does not expand the user's
  authorization or bypass approvals.
- A created thread may still be queued, and idle does not mean successful.
  Inspect output, activity, or changes as needed before reporting results.
- Hidden workers remain accessible in the parent's **Workers** panel; no split
  pane is needed. Use `bb thread <command> --help` for additional options.
