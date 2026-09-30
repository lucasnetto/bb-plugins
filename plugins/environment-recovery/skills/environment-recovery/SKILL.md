---
name: environment-recovery
description: Restore a removed workspace on its original thread or create a continuation from another branch.
---

# Recover a removed workspace

Inspect the source without creating anything:

```sh
bb environment-recovery preview <thread-id> --json
```

Prefer native restoration on the original thread when available in BB 0.44 or
later. An archived thread is unarchived first and no agent turn starts. An explicit
alternate branch or unavailable provider restoration uses a fresh managed Git
worktree and a visible continuation:

```sh
bb environment-recovery recover <thread-id> --json
bb environment-recovery recover <thread-id> --branch origin/my-feature --json
```

Only recover when the user asks to resume or recover this work. The UI action
**Recover workspace** opens the same workflow on threads with destroyed
environments. For a continuation, the new thread gets a bounded copy of the original request and
recent user/assistant messages. Its first response summarizes progress and waits
for the user. A continuation leaves the original thread unchanged and links it in the new prompt.
Native restoration keeps the original conversation and thread ID. A restoration
failure never silently creates a continuation.

Recovery uses the original machine and project checkout. The machine must be
online, with the Worktree provider available and a local or remote Git branch
present in that checkout. Missing branches never silently fall back to main;
specify an alternative only when the user intends it. A fresh branch is created
from the chosen branch's committed contents. Uncommitted work, native agent
state, attachment contents, and arbitrary cloud sandbox files are not recovered.

Repeated requests for the same source environment and branch reuse the recorded
continuation thread. If creation's outcome is uncertain, inspect the thread list
and plugin logs; do not issue repeated creates or modify BB's database. If that
continuation later loses its environment, recover the continuation itself.

Report the returned thread as `@thread:<thread-id>`. No BB core changes or
direct database writes are involved.
