# Profiles

Switch between your Personal and Work bb instances using the profile icons above New thread. The active profile is highlighted; hover an icon to see its name. The sidebar footer and plugin settings also offer the full profile selector. Each instance keeps its own threads and provider accounts; switching pages leaves running work alone.

## Settings

Open Settings → Installed plugins → Profiles on each instance. Configure the
account labels and public/local addresses there. Those deployment-specific
values live in BB settings, outside this repository. Remote browsers only receive
links with a configured public address. Labels and addresses update immediately.

The server data directory selects the instance: `.bb` is Personal and `.bb-work`
is Work. Unknown directories fail instead of choosing an account. Cursor uses
the bootstrap's Personal launcher under `~/.local/bin` or the Work launcher on
PATH. These are conventions, not settings. Disable the bundled ACP provider before
enabling Profiles because both register Cursor. The old Personal provider ID
remains available for existing conversations.

The plugin follows the profile bootstrap's service and launcher conventions.
Refresh discovers each plugin's registered source and rejects local task
worktrees. The desktop app location comes from the running BB CLI, falling back
to the standard macOS installation. These implementation details need no settings.
The restart helper caches only the two local URLs so it also works while BB is
down. Edit addresses on the plugin page, not in the generated cache.

Both profiles discover models and thinking levels through their authenticated launcher's `--list-models` command. Work filters the `auto` and `default` aliases from that catalog because its account rejects Auto over ACP. Personal retains Auto. Sessions still launch through the original account-specific command. Install the Work launcher and key with the sibling Orbisa repository’s `scripts/install-bb-work-cursor`.

The workspace pins an SDK 0.4.47 patch in `patches/@get-bb__plugin-sdk@0.4.47.patch`. It makes ACP select the actual effort option when Cursor also exposes a thinking toggle, turns thinking off for None and on for other efforts, and reports rejected effort changes instead of silently continuing. Keep this patch until an SDK update includes these fixes; the bridge tests verify the wire requests for every supported Opus and Sol level. Install dependencies with pnpm before building so the host artifact includes the patch.

The catalog filter runs the bridge executable as Node, including when the installed bb uses Electron, and removes that runtime flag before launching Cursor. To exercise the installed runtime as well as Node, run `CURSOR_TEST_BRIDGE_EXECUTABLE=/Applications/bb.app/Contents/MacOS/bb node --experimental-strip-types --test plugins/profiles/*.test.ts` from the repository root.

Choose Profiles under Settings → Appearance → Navigation if another navigation replacement is selected. The profile row keeps BB’s standard navigation and works alongside a custom thread list.

Switching profiles restores the last thread visited in that profile on this browser. Each profile stores its own last thread locally. If no thread has been remembered, the profile opens New thread; opening New thread directly never restores an old thread.

Restoring the last thread uses BB’s client-side navigation, avoiding a second full page load after the destination instance opens. Switching between instances still loads the destination app once.

## Refresh local plugins across profiles

### Desktop updates

After a desktop update finishes installing, run:

```sh
bb-restart           # restart Personal and Work
bb-restart personal  # restart only Personal
bb-restart work      # restart only Work
```

The command immediately asks each existing profile launch service to shut down
cleanly. launchd restarts it with its existing account configuration. The command
waits for a new launcher process and an HTTP response reporting the installed bb
version, then prints `ready` for each profile. Reopen bb or reload an already-open
error page afterward. Running sessions may reconnect or be interrupted.

This is a standalone CLI so it works even when bb's UI or plugin server cannot
load. There is no automatic update watcher or fixed 30-second delay. Readiness
has a 60-second timeout per profile; failures return a nonzero exit status and
point to the service logs. Stopped or unloaded services are reported as errors.
If the app bundle changes during the command, rerun it after installation finishes.

Install from the permanent bb-plugins checkout:

```sh
python3 plugins/profiles/restart.py --install
```

This links `~/.local/bin/bb-restart` to the Profiles helper in the permanent
checkout. Keep that checkout available and `~/.local/bin` on PATH. The command
uses the existing account-aware profile services and never switches provider
credentials or the calling shell's server URL.

### Installed plugin refresh

Use `bb profiles refresh <plugin-id> ...` after validating changes in a plugin's
permanent checkout. With no IDs it refreshes all installed plugins in each
profile, including plugins outside bb-plugins. Discovery uses BB's installed-plugin
inventory; it does not scan repositories or require a particular working directory.
`--check` only reports installation path, package version, content-derived build
ID when files are available, app bundle hash, enabled state, and health. An
unreachable profile or unhealthy installation is reported as a failure.

Local `path:` plugins are built once per resolved package directory, with their
dependencies already installed. Git, npm, and built-in plugins reload their
installed versions without rebuilding or fetching updates. Disabled plugins stay
disabled and are not reloaded. Each profile keeps its own source and version;
different local sources for the same plugin are built separately. A failed build
is never loaded. Builds run on the server machine containing the registered paths.

Missing local directories and task worktrees are reported instead of rewritten.
After moving a plugin, register its new permanent path with `bb plugin install
path:<directory>` in each profile. The next refresh discovers it automatically.
The command does not pull Git, install dependencies, discard local changes, or
update managed plugins. Use `bb plugin update` for explicit managed updates.

`bb profiles refresh <plugin-id> --install-missing` can copy an existing local
installation from the other profile, including its enabled state. It requires
explicit IDs and cannot be combined with `--check`. A plugin absent from both
profiles, or installed from Git/npm, must first be installed explicitly in the
target profile. Without this flag, refresh never installs missing plugins.
Publish source changes through the normal repository workflow.

Profile isolation still applies to threads and provider accounts. The bounded
refresh helper addresses the two local servers only for plugin administration;
it never changes the calling thread environment or account credentials. Do not
copy its internal server selection into agent commands. The former shell
`bb-reload-all` function can be replaced by `bb profiles refresh "$@"`.
