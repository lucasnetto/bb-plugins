---
name: bb-workers
description: Delegate work to hidden bb child threads and coordinate their results while the user stays with the parent agent. Use when the user asks to use bb workers, invokes $bb-workers, requests a separate implementation model in bb (for example, "delegate to Fable" or "use Luna low as the worker"), or project instructions explicitly require bb worker delegation. Do not trigger for ordinary coding tasks, questions about the Workers panel, generic mentions of workers, or native subagent requests without bb context.
---

# BB workers

Keep requirements, decisions, review, and user communication in the parent
thread. Delegate concrete tasks through `bb thread spawn`, not a provider's
native subagent tool: the Workers panel discovers bb children by parent ID.

## Resolve the handoff

1. Read `bb status --json` for the current project, thread, and environment.
   Inspect the relevant repository instructions and code before assigning work.
2. Resolve the requested provider, model, and reasoning level using
   `bb provider list --environment <environment-id> --json` and
   `bb provider models <provider-id> --environment <environment-id> --json`.
   Use the catalog's exact model ID in `--model`, not its display label or a
   guessed alias such as `luna`. Include `--provider` and the resolved environment
   explicitly in every new-worker command.
   Preserve the user's exact model choice. Do not silently substitute another
   model if it is unavailable; explain the mismatch and ask for a choice.
3. If model settings are unspecified, use an explicit project convention or
   the current parent's execution settings. Do not invent a universal worker
   model or change the model of the parent conversation.
4. Reuse a suitable existing child for follow-ups. Create one worker per bounded
   task; parallelize only independent work. The same environment shares files,
   so give each writer exclusive ownership of its files and avoid editing them
   concurrently. Use a separate worktree when isolation is needed, then review
   and integrate its changes before calling the task complete.

## Start a hidden child

```sh
bb thread spawn --project <project-id> --parent-self \
  --environment <environment-id> --visibility hidden \
  --provider <provider-id> --model <model-id> --reasoning-level <level> \
  --title '<short task title>' --prompt '<self-contained handoff>' --json
```

Use IDs from current bb state, never copied example IDs. Specify the project
explicitly. Let worker permissions inherit from the parent; do not add `full`
or change approval settings to make delegation work. Use `bb thread spawn
--help` for current flags; if bare `bb` resolves to an unrelated executable,
use `"$BB_CLI"` when available.

A new child does not automatically inherit this conversation. Include:

- Objective and concrete acceptance criteria.
- Relevant files, decisions, constraints, and any existing local changes.
- File ownership and shared-workspace coordination rules.
- Validation to perform and expected deliverable.
- A request to report changed files, checks, outcomes, and blockers.
- Whether further delegation is authorized; default to doing the assigned task
  without creating more workers.

Quote shell arguments correctly. For a long handoff, use a local UTF-8 prompt
file and pass `--prompt "$(cat /absolute/path/handoff.txt)"`. Do not interpolate
untrusted text directly into shell code or include credentials in prompts.

Capture the returned worker ID. Tell the user briefly what was delegated and
which model is running. Keep it hidden and do not open split panes unless the
user asks. The user can inspect it via **Workers** in the parent's right panel;
archived and hidden children remain accessible there.

## Coordinate and review

- Use `bb thread tell <worker-id> '<follow-up>' --json` for corrections or a
  revised handoff. It steers active work by default; use `--mode queue` for
  a non-urgent follow-up. Inspect the returned delivery status and do not resend
  a message just because it was queued.
- Continue independent parent work while the child runs. Child completion and
  blockers report back to the parent. When a blocking wait is useful, use
  `bb thread wait <worker-id> --timeout 50`, then check the outcome. Avoid busy
  polling and shell sleeps; remain responsive to the user.
- Read `bb thread output <worker-id>` and inspect the actual diff and relevant
  validation. Use `bb thread log <worker-id>` for missing context or failures.
  An idle thread is not evidence that its assigned task succeeded.
- Send fixes back to the same worker when it owns implementation. If it used a
  separate environment, review that environment's diff and integrate explicitly.
  Do not claim a parent workspace has changes that exist only in a worktree.
- Keep approval requests and blockers visible to the user; do not grant broader
  access to bypass them. Stop a worker with `bb thread stop <worker-id>` if the
  user cancels its task.
- When no more follow-ups are needed, `bb thread stop <worker-id>` releases its
  loaded runtime while preserving the conversation for the Workers panel. Do
  not delete workers or automatically archive them merely to hide sidebar rows.

Report the combined outcome, validation, and any remaining limitations in the
parent thread. Do not stop at forwarding worker claims without reviewing them.
