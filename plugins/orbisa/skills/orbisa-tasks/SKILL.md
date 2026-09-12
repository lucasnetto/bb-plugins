---
name: orbisa-tasks
description: Use dedicated Orbisa task VMs in BB, inspect their lifecycle, or explain settling and deletion. Use when the user requests an Orbisa task VM; do not trigger for ordinary coding or generic worker requests.
---

# Orbisa task VMs

Choose **Orbisa task VM** in BB's environment picker to create a dedicated VM
and project checkout. The server must run BB 0.43.0 or later, with this plugin,
OrbStack and an isolated `cursor-base` template available.

For an authorized task, the CLI equivalent is:

```sh
bb thread spawn --project <project-id> --environment-provider orbisa-task \
  --prompt '<task>'
```

Apply the session's execution/model preferences. Use the existing environment
ID when related workers should share the task VM. Creating a new composition
creates a separate VM; shared Cursor/T3 Code Orbisa slots are unaffected.

Inspect with `bb orbisa tasks`. Output includes machine IDs, lifecycle phase,
last activity and `deleteAt` (epoch milliseconds or null), capped at 100 rows.
Use `bb machine show <id>` for BB's progress/errors, `bb machine suspend <id>`
or `bb machine resume <id>` for explicit lifecycle actions. BB handles queued
work during suspension/resumption. Resume tries the existing host-specific daemon
service first, confirms the connection, and falls back to BB bootstrap if needed.

Task VMs suspend after 15 idle minutes by default. Setting
`bb plugin config orbisa set taskIdleMinutes 0` disables idle suspension.
`taskTemplate` selects a clean isolated template. Never choose a shared worker
or an existing task VM as the template.

New tasks clone a clean prepared base with BB, Codex and user skills already
installed. The first creation after a BB artifact, Codex, skills or recipe
change refreshes that base. Task-specific package installs and repository setup
are not promoted back to the base. Add reusable tooling to `task-base.ts` and
bump its recipe revision. Skill fingerprints ignore timestamps and archive
ordering but include content and permissions. Background cleanup retains the
selected base and one fallback; other verified stopped bases expire after seven
days without use. Git caches expire after 30 days without use; active transfers
are preserved. Existing caches receive a full grace period on upgrade. Cleanup runs
at plugin startup and hourly, independently of task launches. Skill archives are
reused when a source metadata scan is unchanged; content hashes remain authoritative
for base versions. Credential reads overlap VM boot.

Each task gets independent Git checkouts from profile-local cached bundles.
Single-repo projects refresh from their Git remote. The Work 180seg catalog
seeds the current committed branches under `~/Developer/180seg`, including
unpushed commits, and preserves relative folders and parent `AGENTS.md`.
Uncommitted/ignored files are excluded; upstream updates must reach the local
catalog first. Select branches inside individual catalog repositories.
Catalog discovery and checkout use up to four concurrent repositories, selected
from local benchmarks. A failed checkout cancels siblings and waits for started
operations to finish; retries preserve previously completed checkouts.

Provisioning logs include stage timings in milliseconds, with success/failure
and per-repository Git timings. Use these when investigating slow launches.

Settling is BB archiving. Once the last live thread using a task machine is
settled, deletion is scheduled for ten minutes later. Un-settling during that
window cancels deletion and preserves the disk. A live shared worker retains
the VM; archiving a parent follows BB's native child-archive behavior.
The periodic sweep can add up to about one minute to a deadline.

Settling authorizes discarding all remaining VM data: no dirty-Git checks,
automatic commits, pushes, or backups. Publish anything worth keeping before
settling. After deletion the conversation remains, but un-settling does not
recreate the VM; start a fresh task environment from the published repository.

The existing `bb orbisa status`, `bind`, and `wake` commands apply only to the
three shared Orbisa slots, independently of task VMs. Follow the active BB
profile; never substitute another profile's provider credentials.
