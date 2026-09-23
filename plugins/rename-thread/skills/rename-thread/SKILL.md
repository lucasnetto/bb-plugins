---
name: rename-thread
description: Regenerate an existing BB thread title from its original request and recent conversation when the user asks to automatically rename it.
---

Use `bb rename-thread start <thread-id>` to begin generation, then
`bb rename-thread status <thread-id>` to check completion. A `running` result
means the job is still active. `renamed` includes the applied title; `unchanged`
explains why the current title was kept; `failed` includes a retry instruction.

Generation uses the provider selected in Rename Thread settings. Codex runs
separately on the server; other providers run in a hidden helper on the primary
machine, stopped and archived afterward. It does not send a message to the
target thread. Personal and Work use their own provider authentication.
Choose the provider and model in the Rename Thread plugin settings, or use
`bb rename-thread model <model-id>` to set one from the CLI.
Do not inspect or copy authentication files to resolve a generation failure.
