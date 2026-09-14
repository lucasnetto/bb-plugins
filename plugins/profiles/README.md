# Profiles

Switch between your Personal and Work bb instances using the profile icons above New thread. The active profile is highlighted; hover an icon to see its name. The sidebar footer and plugin settings also offer the full profile selector. Each instance keeps its own threads and provider accounts; switching pages leaves running work alone.

## Accounts

Personal uses the existing Codex home and the Personal Cursor API key from macOS Keychain. Work uses `~/.codex_work` on the Mac and the Work Codex login on its Orbisa machines. Its `bb-cursor-work-acp` launcher uses a dedicated Work API key: macOS Keychain on the Mac and a mode-0600 file on the VMs. Both launchers fail if their key is unavailable. The plugin reuses BB's public Cursor ACP bridge and preserves the old Personal Cursor provider ID for existing conversations.

## Setup

This installation is configured for `~/.bb` and `~/.bb-work`, with separate server and daemon services. Disable the bundled ACP provider before enabling this plugin, because both register Cursor. The profile is determined by the instance's data directory and cannot be changed by the selector. Local clients switch between loopback addresses; remote clients switch between the two authenticated bb Connect addresses.

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

### Local plugin builds

Use `bb profiles refresh <plugin-id> ...` after validating a change in the
permanent `~/Developer/lucasnetto/bb-plugins` checkout. With no IDs it refreshes
installed local bb-plugins plugins. `--check` only reports installation path,
package version, content-derived build ID, app bundle hash, enabled state,
and health for each profile. It reports an unreachable profile as a failure.

The command builds each plugin once, reloads both installations, repairs stale
local source paths, preserves disabled state, and verifies the result. A failed
build is never loaded. It does not pull Git, discard local changes, update
managed third-party plugins, or install missing plugins unless explicitly requested with `--install-missing`.
Use `bb profiles refresh <plugin-id> --install-missing` to install a new local
plugin in both profiles. This option requires explicit plugin IDs and cannot
be combined with `--check`. Publish source changes
through the normal repository workflow.

Profile isolation still applies to threads and provider accounts. The bounded
refresh helper addresses the two local servers only for plugin administration;
it never changes the calling thread environment or account credentials. Do not
copy its internal server selection into agent commands. The former shell
`bb-reload-all` function can be replaced by `bb profiles refresh "$@"`.
