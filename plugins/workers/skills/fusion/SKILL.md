---
name: fusion
description: "Use only when the user invokes $fusion or explicitly asks to use Fusion mode: keep the current agent as lead and delegate implementation to one persistent BB worker using a configured model preset."
---

# Fusion

You, the model reading this skill, are the lead. Keep your current thread and
model, and invoke one persistent sidekick yourself for
substantial execution work, while the lead owns the plan, interpretation of
ambiguity, review, and user communication. This is an opt-in workflow; ordinary
requests to use workers do not activate Fusion.

Read the [BB workers skill](../bb-workers/SKILL.md) for spawning, messaging, and
lifecycle commands. Use `bb_worker_thread`; do not create visible threads or use
native subagents. Follow the user's task scope and existing permissions.

## Select and retain a sidekick

- Honor the user's chosen worker preset. Otherwise select a preset advertised
  by `bb_worker_thread` whose description fits Fusion implementation work.
  State the choice briefly. Preset names are user-defined, not built-in.
- Pass the selected `preset` explicitly. Omitting it inherits the lead model,
  which defeats the intended model pairing. Do not silently fall back to
  inheritance, invent a preset, or bypass preset selection with raw model
  overrides or thread updates. This overrides the general BB workers inheritance
  default: if the tool schema has no `preset` field, do not spawn.
- If no suitable preset is exposed, explain that one must be configured under
  **Settings → Workers → Worker presets**, then the agent session must be
  restarted/resumed to see it. Ask for the missing model choice only if needed;
  continue useful lead work meanwhile. If a chosen preset fails validation,
  report the failure and continue as lead until a usable choice is available.
- Reuse the returned worker `threadId` for subsequent briefs and corrections.
  Preserve the ID, preset, current assignment, and file ownership in continuation
  notes so compaction or a resumed lead does not create duplicate workers.
- A sidekick executes the brief and reports to its lead. Tell it not to create
  further workers or activate its own Fusion loop unless explicitly assigned.

## Invoke the sidekick yourself

After selecting the preset and preparing the first brief, you must make an
actual `bb_worker_thread` tool call to delegate the work. Loading this skill,
choosing a preset, or announcing delegation does not start a worker. The user
does not need to launch it or append a worker name to their Fusion request.

For example, if `fusion-worker` is the selected advertised preset, invoke:

```json
{
  "title": "Implement the planned change",
  "preset": "fusion-worker",
  "prompt": "You are my implementation sidekick. Do not delegate further. [Include the task brief, file ownership, acceptance criteria, checks, and my thread ID.]"
}
```

Replace the example title and prompt with the real assignment. The preset
selects the sidekick's provider, model, and reasoning level; do not pass a raw
`model` argument. Inspect the returned execution settings to confirm the pairing
and save its `threadId`. Send later briefs and corrections to that same worker
with `bb thread tell <worker-id> --message-file <brief-file>`, rather than calling
`bb_worker_thread` again. You remain responsible for review and the user reply.

## Divide work by judgment

Read enough relevant code to choose the approach and define success. Delegate
bounded implementation, mechanical changes, focused code lookups, and tests.
Keep architectural choices, unclear requirements, and planning-critical
investigation with the lead. Give a less capable sidekick more concrete
boundaries and examples; leave routine implementation choices to it.

Hand off meaningful chunks. Avoid a message for every edit or command, and avoid
redoing the worker's entire exploration. Small tasks may be cheaper and quicker
to finish directly; say so and use the lead when delegation adds no value.

Each brief should contain:

- The desired behavior, relevant context and paths, and acceptance criteria.
- Constraints, non-goals, and the files or areas the sidekick may edit.
- The checks needed to demonstrate success and any known baseline failures.
- The lead's thread ID, when to report a blocker, and the instruction to return
  changed paths, a concise result, checks with outcomes, and unresolved issues.
- The instruction to execute as the sidekick without further delegation or
  activating Fusion itself, unless the lead explicitly assigns that work.

The worker starts without the lead's conversation. Supply the necessary facts
and file references, not the entire transcript. Ask it to flag contradictions
with evidence before expanding scope or replacing the agreed approach.

## Execute, review, and correct

Workers share the lead's checkout. Assign one writer to an area at a time. While
the sidekick edits, do independent planning or review elsewhere, or wait for its
report. Do not edit its files or run checks against partially written changes.
Before delegating work begun by the lead, finish or hand off its partial edits
and release those files. A newly available preset does not itself start a worker.
Use completion/blocker notifications and bounded waits instead of frequent
status polling.

Read the result and inspect the actual diff and relevant test evidence. Idle
status alone is not success. Verify acceptance criteria and intent, especially
behavior the worker's own tests may miss. Re-run checks when changes, failures,
or missing evidence justify it; do not repeat an already adequate test run.

Send specific corrections to the same worker, preserving its context. If it
repeats a failure after focused feedback, uncovers a design decision, or needs
substantial replanning, bring that work back to the lead. Request a concise
handoff, stop the worker, and confirm it is no longer editing before taking
ownership. Preserve unfinished work and inspect it before continuing.

For cancellation or an unusable worker, stop it promptly and inspect its partial
changes. Do not spawn replacements blindly or continue a failed approach in a
loop. Use a different preset only when authorized by the user's model choices;
this skill does not implement automatic model switching.

## Finish

The lead makes the completion judgment and gives the user the result, validation,
and material limits. Stop the sidekick with `bb thread stop <worker-id>` when
the task finishes or it is no longer needed, including failure paths. Stopping
preserves its conversation for later follow-ups; do not delete it.

Persistent threads preserve conversation, not guaranteed provider cache hits.
Do not send keepalive prompts, force compaction, or claim savings without
measured evidence. When evaluating a pairing, compare completed task quality,
correction rounds, elapsed time, and available usage across both agents.
