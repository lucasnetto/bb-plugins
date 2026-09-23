---
name: orbisa
description: Inspect Orbisa-managed BB environments and archive cleanup deadlines.
---

Run `bb orbisa machines` to inspect Orbisa machine lifecycle and deletion deadlines.
Create environments with `orbisa-machine`, using machine inputs `runtimeHostId`
and `backend` (`incus` on Linux, `orbstack` on macOS); `image` is optional.
Use the same-named environment composition for automatic project checkout setup.
Orbisa 0.2.0 and a clean tooling image must already exist on the runtime host.

Archiving the last owning thread stops its machine; all files are deleted ten
minutes later. Commit and push work first. Unarchiving within that window cancels
deletion, and the next execution wakes the retained environment. Hidden threads
also count as owners. Finishing a turn does not trigger retirement.

Use `bb machine suspend|resume|remove` for managed lifecycle operations so BB
coordinates enrollment and teardown. Use `bb connect expose PORT` inside a guest
thread to share its server. Do not publish all guests onto one host port.
The independent `orbisa` CLI manages generic environments and has no BB policy.
