# Orbisa for bb

## Persistent BB machines

The `orbisa-persistent` machine provider manages BB-only machines separately
from both disposable task VMs and the original Cursor/T3 Code VMs:

- Personal (`~/.bb`): `ln-orbisa-01`.
- Work (`~/.bb-work`): `180seg-orbisa-01` and `180seg-orbisa-02`.

Each profile owns its own machines and credentials. After 15 idle minutes, the
plugin releases idle agent runtimes while keeping the BB daemon connected and the
machine selectable for new threads. Thread history, files and credentials remain;
BB reloads the provider session on the next message. Set
`persistentRuntimeIdleMinutes` to `0` to disable runtime cleanup.

Cleanup skips machines with active or starting threads, queued messages, pending
interactions, background activity, or open terminals. It includes hidden workers
and archived idle threads. Incoming messages wait during cleanup and are retried
afterward. Cleanup runs once per activity cycle, with a fresh idle grace after a
plugin reload. Failures are retried on the next sweep. It does not stop arbitrary
development services or force memory reclamation.

Full VM idle suspension is disabled by default because BB currently disables
suspended machines in its new-thread picker. Set `persistentIdleMinutes` above
`0` to opt in; existing saved settings are preserved. Settling threads never
deletes these VMs or their files. Only explicit machine removal deletes a VM.
Running or starting threads (including hidden workers) defer suspension; BB also
refuses suspension while terminals are open.

Build the common development template on the Mac with
`scripts/bootstrap-bb-base` (inside this plugin). It starts from clean Ubuntu and
uses the sibling Orbisa checkout's development-tool installer. It installs no
Cursor desktop app, `cursor-agent`, or T3 Code. No repositories, BB enrollment,
or persistent account credentials belong in this template. The provider prepares
BB and Codex before cloning and refreshes the owning profile's credentials into
volatile guest storage on each wake. Cursor SDK uses the profile's API key;
install its runtime through BB after creating each machine.

Run these commands from the matching profile, without changing an active
thread's server URL or credentials:

```sh
# Personal
bb machine create --provider orbisa-persistent --inputs '{"slot":"01"}' --key ln-orbisa-01
bb machine provider-cli install ln-orbisa-01 cursor-sdk

# Work
bb machine create --provider orbisa-persistent --inputs '{"slot":"01"}' --key 180seg-orbisa-01
bb machine create --provider orbisa-persistent --inputs '{"slot":"02"}' --key 180seg-orbisa-02
bb machine provider-cli install 180seg-orbisa-01 cursor-sdk
bb machine provider-cli install 180seg-orbisa-02 cursor-sdk
```

Work creation seeds committed local repositories from `~/Developer/180seg` into
`/workspace/180seg`. It includes unpushed commits, excludes uncommitted/ignored
files, and preserves existing seeded repositories on retry. Resume never reseeds
or resets repositories. Add this path as a source of Work's existing `180seg`
project on each new machine. Personal machines are general-purpose: use BB's
project setup on the new machine for the repositories needed there.

## Disposable task VMs

Choose **Orbisa task VM** from the new-thread environment picker, or use:

```sh
bb thread spawn --project <project-id> --environment-provider orbisa-task --prompt '<task>'
bb orbisa tasks
```

BB creates a new machine and prepares the project's Git checkout. Reuse that
environment ID for workers that should share it. Each BB instance has its own
`bb-task-<instance hash>-<task hash>` namespace. The three shared Orbisa slots,
Cursor registration, T3 Code access, and their SSH configuration are unchanged.

- Idle task VMs stop after **15 minutes** by default, retaining their disks.
  BB coordinates suspension and resumes before queued work runs. Set
  `taskIdleMinutes` to `0` to disable idle suspension.
- Settling uses BB's archive lifecycle. Once no live threads need a task VM,
  the plugin persists a **10-minute deletion deadline**. Un-settle before that
  deadline to cancel deletion. Settling again starts a new full window.
- A live worker or another thread on the VM retains it. BB's parent archive
  operation also archives children. Pending starts defer cleanup.
- Deadlines survive server/plugin restarts and are checked at startup, on
  archive/unarchive/delete events, and every minute. Deletion may therefore
  occur up to roughly one minute after the deadline.
- Settling authorizes discarding every remaining file, including uncommitted
  changes, unpushed commits, ignored files, and local stashes. There are no Git
  preservation checks, automatic commits, pushes, or snapshots.
- Once deleted, the conversation remains but un-settling does not recreate its
  machine. Start a fresh task environment from the published repository.

### Prepared base cache

The plugin builds a separate `orbisa-base-<instance>-<fingerprint>` VM from
`taskTemplate`. It preinstalls the exact server BB host artifact, the Mac's
stable Codex version, and current user skills. Each launch checks these inputs;
a change builds a new clean base once, and concurrent launches share that build.
Skills are fingerprinted by archive paths, contents and permissions; timestamps,
archive ordering and uid/gid metadata do not cause rebuilds. The archive itself
is cached in profile-local plugin storage. A scan of paths, targets, permissions,
inodes, sizes, modification times and change times detects source changes before
reuse; archive content still determines the base fingerprint. Changed sources are
checked again after packing so an interrupted or changing archive is not accepted.
Verified base identities are persisted so normal launches do not boot the base
to inspect it. Credential checks overlap VM boot, and each task moves its
preinstalled BB directory into place without recopying it.
The first launch after an update pays the installation cost. Existing task VMs
keep their disks. Base VMs remain stopped between launches.

BB verifies the cached artifact with its SHA-256/ETag and skips reinstalling an
identical package. Its progress may still say “Downloading” before reporting
“The identical server host artifact is already installed”; that is a conditional
update check. Each task still needs fresh credentials, enrollment, a service,
and its own project checkout and project-specific setup hooks.

Only the reproducible setup recipe is cached. Never promote a task disk into
a base: agent-installed packages, repository files and credentials must not
leak between tasks. To add shared tooling, extend `task-base.ts` and increment
its recipe revision. Replacing the source template also invalidates the cache;
in-place edits to that source require a recipe revision. Base cleanup runs in a background job while holding the build/clone lock.
It retains the selected base and one recent fallback; other verified, stopped
bases expire after seven days without use. Running, replaced or unrecognized
VMs are preserved. Existing bases get a full grace period on upgrade.
Task settlement deletes task VMs only.

### Git checkout cache and 180seg

Each new task gets an independent Git checkout from a cached bundle. For a
single-repository project, the Mac checks upstream refs and refreshes the cache
when they change. The guest clones the bundle locally and restores the real
origin. No shared Git object directory ties task disks to the cache.

The Work `180seg` project is a repository catalog, not a single Git repository.
When its source is `~/Developer/180seg`, the plugin discovers repositories under
that folder, preserves relative paths, and seeds each current committed local
branch, including unpushed commits. It copies the parent `AGENTS.md` and rewrites
its workspace path for Linux. Linked worktrees, duplicate origins, hidden
folders, and symlink directories are excluded. Originless repositories are
supported. Uncommitted changes and ignored files are not copied. New local
commits refresh the corresponding bundle on the next task launch; upstream
updates must first reach the local source repositories.

Catalog discovery and preparation run with up to four concurrent repositories.
Each slot covers cache refresh, transfer, and checkout; Git cache locks still
serialize requests for the same repository across task launches. Failure or
cancellation stops scheduling new repositories, cancels siblings, and waits for
started operations to settle before returning to BB cleanup. Completed checkouts
remain retryable without resetting edits. Provisioning logs include total catalog
preparation time as well as per-repository timings.

On this Mac, warm-bundle benchmarks of all 19 repositories took 11–14 seconds
sequentially and about 3.5 seconds with four concurrent checkouts after warm-up.
Eight and 19 concurrent checkouts took roughly 4 seconds. These are repository
preparation measurements, excluding VM boot, enrollment and agent startup; results
vary with disk cache and machine load.

Checkouts live under `~/orbisa-workspaces/<environment-key>`. Choose branches
inside individual repositories for a catalog; a single-repo project also accepts
existing/new branch inputs. Repository dependencies and setup remain workspace
specific. A catalog does not automatically run each child repository's BB setup
hook. Git caches stay in the profile's plugin data directory when task VMs are
deleted, separate from the clean tooling base and shared Cursor/T3 slots.
Unused Git caches expire after 30 days. A background job runs at plugin startup
and hourly (at minute 17), including when no new tasks are launched. It skips active
transfers and cancels on plugin unload. Provisioning no longer awaits cache deletion.
Existing caches receive a full grace period on adoption. New Git mirrors do not
perform a redundant fetch immediately after cloning; existing mirrors still refresh.

### Provisioning timings

The provisioning log records elapsed milliseconds and completion/failure for
base preparation and VM cloning, VM start and credential setup, machine enrollment
and connection, Git cache refresh, and Git transfer plus checkout. Catalog Git
stages are labeled by repository. Timings contain no command output or credentials.
These records expose where startup time is spent without changing the enrollment
workflow.

### Requirements

The **running server**, not just the desktop app/CLI, must be BB 0.43.0 or newer
with SDK 0.4.84. The macOS server
needs OrbStack, `gh`, and the existing Orbisa template (`cursor-base` by
default). The template must have Node/npm/curl/Python, Git and the agent CLIs;
keep it free of BB daemon enrollments, provider logins and task checkouts.
It must have both isolation flags enabled, no Mac mounts and no SSH forwarding.
BB Connect (or another configured server-access provider) must be reachable
from the VM for enrollment. Core owns daemon bootstrap; the plugin prepares independent Git checkouts.

The adapter refreshes GitHub credentials, optional AWS credentials and the
Orbisa signing key into volatile guest storage. It copies only the active
profile's existing Codex login and Cursor key, also into volatile storage.
Missing AWS credentials do not block development. Missing Codex login is
reported; sign in before using Codex. No credentials enter VM metadata or logs.
The first wake also copies the server's user skill directories into the guest,
following symlinks so Mac paths do not break inside Linux. Subsequent resumes
preserve those task-local files. Task wakes also match the guest Codex CLI to
the server's installed stable version.
On resume, the plugin verifies the installation's host ID and service data directory,
clears BB's suspension marker, resets systemd's failed-service state, and starts
the host-specific installed systemd user service. It
waits up to five seconds for BB to confirm its connection. A missing, broken or
nonconnecting service falls back to BB's enrolled-machine bootstrap. Credentials
are refreshed before the resume completes. Fresh VMs still use normal enrollment.
For retirement, BB may briefly wake a suspended VM to run native workspace
teardown. That wake does not depend on refreshing provider credentials.

```sh
bb plugin config orbisa set taskTemplate cursor-base
bb plugin config orbisa set taskIdleMinutes 15
bb machine show <machine-id>
bb machine suspend <machine-id>
bb machine resume <machine-id>
```

`bb orbisa tasks` returns at most 100 machines and their total count, BB phase,
connection status, `lastActivity`, and `deleteAt` (epoch milliseconds or null).

### Implementation

`task-vms.ts` implements VM operations through OrbStack with deterministic
allocation names and VM-ID checks. `task-provider.ts` registers the public BB
machine provider and a composition with `orbisa-checkout`.
`task-checkout.ts` creates workspaces through OrbStack, `task-git-cache.ts`
maintains profile-local Git bundles, and `task-catalog.ts` discovers 180seg repos.
`task-policy.ts` owns durable idle/retirement deadlines. Machines intentionally
use `ephemeral: false`: BB's ephemeral path deletes immediately. At the deadline
the policy requests BB's normal machine removal, which owns cleanup and retries.
The adapter operates only on this instance's dedicated task namespace.

## Development

Run `node --experimental-strip-types --test plugins/orbisa/tests/*.test.ts`,
`node_modules/.bin/tsc -p plugins/orbisa/tsconfig.json`, and
`bb plugin build plugins/orbisa` from the repository root. Refresh both profiles
after changes. The backend uses the public plugin SDK. BB owns cancellation of machine
operations. Disabling the plugin pauses its idle/deletion policy until reload.

## Provisioning readiness and failures

After checkout creation, one readiness stage checks the writable workspace,
resolved executable paths and CLI capabilities, GitHub token availability,
optional Codex/Cursor account material, and the host's connection to this
profile. It reports every check and persists the latest result per task host.
Missing optional provider accounts are warnings because another provider may
be used; local account material does not prove an unexpired remote session.
No credential values or provider output are included in the report.

Failures identify `host-unavailable`, `unsupported-workspace`,
`authentication-failed`, or `incompatible-runtime` and a corrective action.
Connection probes and enrollment retry identified transient transport errors
at most twice; configuration failures and full provisioning are not retried.
Readiness has its own elapsed-time stage alongside existing preparation and
checkout timings.

Prepared-base receipts bind the content fingerprint to the OrbStack VM ID. A
receipt hit does not wake the base. Recovery without a valid receipt checks
the marker's fingerprint, rather than just its existence; interrupted or stale
builds are rebuilt. Recipe 2 also pins the Clojure helpers to the template's
Babashka interpreter so BB's launcher cannot capture their `bb` shebang.
Keep `BASE_RECIPE` current when base installation steps change.
