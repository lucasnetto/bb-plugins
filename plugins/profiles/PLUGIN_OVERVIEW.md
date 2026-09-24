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

Choose Profiles under Settings → Appearance → Navigation if another navigation replacement is selected. The profile row keeps BB’s standard navigation and works alongside a custom thread list.

Switching profiles restores the last thread visited in that profile on this browser. Each profile stores its own last thread locally. If no thread has been remembered, the profile opens New thread; opening New thread directly never restores an old thread.

Restoring the last thread uses BB’s client-side navigation, avoiding a second full page load after the destination instance opens. Switching between instances still loads the destination app once.

## Refresh plugins

Use `bb profiles refresh [plugin-id ...]` to refresh installed plugins in both
profiles, including plugins from other repositories. Local plugins build once
per source directory; Git, npm, and built-in plugins reload their installed
versions. Sources and enabled states are preserved. Use `--check` to inspect
paths, builds, and health without changing anything. Explicit `--install-missing`
can copy a local installation from the other profile. Dependencies must already
be installed, and local sources must be permanent directories.
