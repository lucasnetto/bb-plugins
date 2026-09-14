---
name: rename-thread
description: Regenerate an existing BB thread title from its original request and recent conversation when the user asks to automatically rename it.
---

Use `bb rename-thread start <thread-id>` to begin generation, then
`bb rename-thread status <thread-id>` to check completion. A `running` result
means the job is still active. `renamed` includes the applied title; `unchanged`
explains why the current title was kept; `failed` includes a retry instruction.

Generation runs separately through Codex on the BB server machine. It does not
send a message to the target thread. Personal and Work use their own Codex homes.
The model setting is `bb plugin config rename-thread set model <model>`.
Do not inspect or copy authentication files to resolve a generation failure.
