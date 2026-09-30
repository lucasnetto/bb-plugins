# Copy and use BB plugins with an agent

This is the author's personal collection of plugins for [BB](https://getbb.app/).
Use it shadcn-style: copy the plugins you want into a permanent repository you
own, adapt them to your setup, and maintain your copy. Each plugin can be
selected independently, with optional integrations described below.

The author develops these for personal use. There are no published packages,
marketplace releases, support commitments, or backwards compatibility
guarantees. Upstream plugin IDs, settings, behavior, and BB/SDK requirements
can change without an upgrade path. Treat this repository as reference code,
not a dependency or automatic update source.

## Instructions for the agent

1. Inspect the user's BB installation, machine, existing plugins, and available
   tools. Preserve their existing configuration and checkout changes.
2. Use the [plugin tour](#plugin-tour) to explain what is available. If the user
   has already selected plugins, proceed with those. Otherwise, help them choose
   based on their workflow; do not treat the whole collection as a required bundle.
3. Check the selected plugins' READMEs and `package.json` files for prerequisites
   and BB/SDK compatibility. Explain any missing setup before installing those
   plugins. Continue with selections whose prerequisites are satisfied.
4. Copy the selected plugin directories and their supporting files into a
   permanent repository owned by the user. Adapt dependencies, tooling, and
   deployment assumptions to that repository. Build and install from the copy
   using the commands below. Installation authorization includes these steps;
   do not ask again for each command. Keep long builds in a background task or
   yielding terminal, collect their exit status, and report failures before
   proceeding. Preserve MIT and third-party license notices.
5. Verify each installed plugin, then show the user where to find it and how to
   try one useful feature. Report the user's source path, installed plugin IDs,
   configuration changes, and anything still blocked or unverified.

Do not configure automatic pulls from this repository. Later upstream changes
are optional material to review and port into the user's copy. Do not copy
the author's deployment instructions in `AGENTS.md` into the user's project.

Keep changes within plugins and their settings; never patch BB core or its
installed bundles. Use the user's own accounts and paths. The author's
Personal/Work URLs, credentials, models, and worker presets are not defaults
to copy. Do not request secrets in chat; use the plugin's documented credential
flow. Refer to a plugin's bundled `skills/` when helping with its operation.

Some plugin READMEs include maintainer commands such as `bb profiles refresh`.
For a normal installation, use this guide's build/install/reload commands.
Profiles is only needed for the specific dual-instance setup described in its
README; it is not an installation prerequisite.

## Prerequisites and machine selection

- A running BB installation and its CLI. If BB is missing, start with
  [BB's installation instructions](https://getbb.app/).
- Git, Node.js 24+, and the Vite+ CLI (`vp`). Follow the
  [Vite+ setup instructions](https://viteplus.dev/guide/) if `vp` is missing.
  The source snapshot selects pnpm through `packageManager` and pins its local
  Vite+ dependency. Keep those versions and the lockfile for the initial copy;
  the user can deliberately adapt the tooling afterward.
- A permanent directory on the **BB server machine**, accessible to the server.
  A `path:` installation refers to files on that machine. If the agent is in a
  remote task environment, perform the copy/build/install on the server
  machine through the user's existing access, rather than passing it a path
  that only exists in the task environment.

The shell examples below use a POSIX shell. Resolve the BB CLI once in that
shell and reuse it (if the tool starts a fresh shell per command, repeat the
assignment):

```sh
BB_PLUGINS_BB="${BB_CLI:-bb}"
"$BB_PLUGINS_BB" --version
"$BB_PLUGINS_BB" status --json
"$BB_PLUGINS_BB" plugin list --json
"$BB_PLUGINS_BB" plugin install --help
git --version
node --version
vp --version
```

`BB_CLI` avoids collisions with other executables named `bb`, such as Babashka.
If it is unset and `bb` is a different program, locate the actual BB CLI and use
its absolute path. Keep the supplied BB server/account context. A working
remote CLI connection does not make local checkout files available to the server.

Compare the selected manifests' `engines.bb` and `engines.bbPluginSdk` with the
installed BB's support. Requirements differ between plugins; for example,
Environment Recovery requires Plugin SDK 0.5.9 or later. Read current CLI help
when flags differ. Report incompatibility instead of relaxing engine ranges or
rewriting dependency pins to force installation.

## Copy the source into your own repository

Choose a permanent directory the user owns. For an existing project, merge the
selected source and required configuration without overwriting its files.
For a new project, the example below copies Hide Models into
`~/Developer/my-bb-plugins`. Confirm that destination does not already exist
before running it; otherwise choose another path or adapt the existing project.

The temporary clone is only a source reference. BB will load the user's copy:

```sh
BB_PLUGINS_REFERENCE="$(mktemp -d)"
git clone --depth 1 https://github.com/lucasnetto/bb-plugins.git "$BB_PLUGINS_REFERENCE/source"
git -C "$BB_PLUGINS_REFERENCE/source" rev-parse HEAD

BB_PLUGINS_COPY="$HOME/Developer/my-bb-plugins"
mkdir -p "$HOME/Developer"
mkdir "$BB_PLUGINS_COPY"
mkdir "$BB_PLUGINS_COPY/plugins"
cp -R "$BB_PLUGINS_REFERENCE/source/plugins/hide-models" "$BB_PLUGINS_COPY/plugins/"

for file in package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json vite.config.ts .gitignore LICENSE THIRD_PARTY_NOTICES.md; do
  cp "$BB_PLUGINS_REFERENCE/source/$file" "$BB_PLUGINS_COPY/"
done
cp -R "$BB_PLUGINS_REFERENCE/source/patches" "$BB_PLUGINS_COPY/"
cp -R "$BB_PLUGINS_REFERENCE/source/tools" "$BB_PLUGINS_COPY/"

cd "$BB_PLUGINS_COPY"
git init
```

Copy any other selected plugin directories the same way, including their
`skills/`, tests, assets, and retained license notices. Keep a record of the
reference commit in the user's project. The new repository has its own Git
history and no upstream remote to pull automatically.

In the copied `vite.config.ts`, set `test.projects` to the selected directories;
for this example, use `["plugins/hide-models"]`. Keep the lint tools while that
configuration imports them. The initial snapshot's catalog and lockfile may
contain unused entries; they can remain until the user deliberately trims them.

Install dependencies at the root of the user's copy:

```sh
vp install --frozen-lockfile
```

The pnpm workspace resolves `catalog:` dependencies and applies the checked-in
SDK patch. If integrating into a different toolchain, resolve those catalog
versions into the user's dependency configuration and carry over the patch
before building. Do not run `npm install` against unresolved `catalog:` entries
or regenerate the lockfile just to conceal a failed frozen install.

BB loads the copied local sources in place. Keep the source, dependencies, and
generated bundles available; do not install from `/tmp`, an agent worktree, or
an environment that will be deleted when a thread is archived.

## Build and install the selected plugins

For each selected plugin, use its **directory** from the tour. For example,
from the root of the user's copy, install Hide Models:

```sh
"$BB_PLUGINS_BB" plugin build plugins/hide-models
"$BB_PLUGINS_BB" plugin install path:. --subdirectory plugins/hide-models --yes
"$BB_PLUGINS_BB" plugin source hide-models --json
"$BB_PLUGINS_BB" plugin list --json
```

Run installation only after that build succeeds. `--yes` makes an already
requested installation noninteractive. Build each selected directory using
`bb plugin build`; this also covers Ocean Theme, which has no package build
script. `vp build` is the Vite application builder and does not produce BB's
plugin artifacts.

The tour distinguishes directory names from installed IDs: **BB Fonts** lives
in `plugins/fonts` but its ID is `bb-fonts`. Use the ID for configuration,
reload, logs, and removal. Package names such as `bb-plugin-bb-fonts` are not
the IDs used by those commands.

Use `--subdirectory` for copied plugin directories. The source repository's
`.bb/plugins.json` index is optional and should only be copied if adapted to
the selected plugins. Direct Git installs are not this guide's workflow;
BB's Git dependency installer also cannot resolve pnpm `catalog:` dependencies.

If an ID is already installed, inspect `bb plugin source <id> --json` first.
For the same local checkout, rebuild and reload. Installing a different local
path moves the source while keeping settings, so only do that when the user
intends to move it. A managed Git/npm installation needs a separate migration;
do not remove it automatically, because removal deletes settings and secrets.

## Plugin tour

Offer a brief overview, then walk through the plugins the user cares about.
For each choice, explain the feature, prerequisites, where it appears, and its
first useful action. The linked READMEs contain full details.

### Appearance and everyday controls

- **[BB Fonts](plugins/fonts/README.md)** — ID `bb-fonts`, directory
  `plugins/fonts`. Choose independent interface/code fonts and sizes, with live
  previews in **Settings → BB Fonts**. Custom fonts must already be installed
  on each viewing device. Starts with BB defaults; pick a preset to try it.
- **[Ocean Theme](plugins/ocean-theme/README.md)** — ID `ocean-theme`, directory
  `plugins/ocean-theme`. T3 Code's Ocean palette in light and dark modes. Select
  **Ocean (T3 Code)** under **Settings → Appearance**. The palette applies to
  the server's clients; each client keeps its own light/dark preference. Record
  the user's current palette if they want to restore it later.
- **[Hide Models](plugins/hide-models/README.md)** — ID `hide-models`, directory
  `plugins/hide-models`. Uncheck models per provider under **Settings → Plugins
  → Hide Models** to simplify the picker. This is a visual filter, not a model
  access restriction; CLI discovery and automation remain available, and
  keyboard navigation/search can still reach hidden rows.
- **[Model Thinking Level](plugins/model-thinking-level/README.md)** — ID
  `model-thinking-level`, directory `plugins/model-thinking-level`. Keeps the
  reasoning label visible beside the selected model even in narrow composers.
  No configuration; try a model with a reasoning option in a narrow pane.
- **[Workspace Opener](plugins/workspace-opener/README.md)** — ID
  `workspace-opener`, directory `plugins/workspace-opener`. BB's existing
  **Open in Cursor / VS Code** action uses the folder's single `.code-workspace`
  file. With zero or several such files it opens the folder. Requires the editor
  and an enrolled owning machine; local Cursor opens use the classic IDE.

### Threads and code review

- **[T3 Sidebar](plugins/t3-sidebar/README.md)** — ID `t3-sidebar`, directory
  `plugins/t3-sidebar`. Thread cards across projects, pinning, manual ordering,
  machine grouping, snoozing, a Settled shelf, and project defaults. Choose it
  under **Settings → Appearance → Sidebar** if needed, then try project filtering
  or pinning. Snoozing leaves work running; settling archives the thread and can
  trigger managed-environment cleanup. Per-project automatic Git pull is off
  by default; enabling it checks clean default-branch checkouts every five minutes.
  Optional PR Review and Rename Thread integrations add PR badges and title actions.
- **[PR Review](plugins/pr-review/README.md)** — ID `pr-review`, directory
  `plugins/pr-review`. A **Pull Requests** inbox, linked PR panels, diffs,
  GitHub reviews, stack actions, agent-generated guides, and a read-only
  **Local Changes** panel. Requires authenticated `gh` on the primary machine
  for the inbox and on the thread's machine for linked reviews. Start by opening
  a PR; link it explicitly to use agent comments and guided reviews. Review and
  merge controls can write to GitHub. **Automatic settling is on by default**
  for eligible idle threads whose linked PRs are all complete; explain this
  before installation. It can be turned off with
  `bb plugin config pr-review set autoSettle false`. Settling can trigger workspace
  cleanup. The **Open in Cursor** action additionally needs Workspace Opener.
- **[Rename Thread](plugins/rename-thread/README.md)** — ID `rename-thread`,
  directory `plugins/rename-thread`. Generates a title from the original request
  and recent messages without adding a turn to the conversation. Configure an
  available provider/model in plugin settings, then use **Regenerate title** in
  T3 Sidebar or `bb rename-thread start <thread-id>`. This makes a model request.
  T3 Sidebar is optional for CLI use. The default Codex helper needs Codex on the
  server's PATH and the documented `.bb`/`.bb-work` account layout; other
  providers use a hidden BB helper with that instance's authentication.
- **[Workers](plugins/workers/README.md)** — ID `workers`, directory
  `plugins/workers`. Agents delegate to hidden children; open **Workers** in the
  parent thread's panel to read, reply, answer questions, or stop them. Ordinary
  workers inherit the parent's model. Optional presets live in **Settings →
  Workers → Worker presets**; none ship by default. Ask an agent to use BB workers
  for a task. The bundled `$fusion` workflow uses one persistent implementation
  worker and requires a suitable configured preset first. New tools/presets are
  discovered when an agent session next starts or resumes.
- **[Environment Recovery](plugins/environment-recovery/README.md)** — ID
  `environment-recovery`, directory `plugins/environment-recovery`. **Recover
  workspace** on a thread with a removed environment creates a new worktree and
  continuation thread from a surviving branch. Requires an online original
  machine, its project checkout, the Worktree provider, and SDK 0.5.9+. Start
  with `bb environment-recovery preview <thread-id> --json`. Saved messages
  provide context; recovery cannot restore deleted uncommitted files or native
  provider state.

### Attention and providers

- **[Jev](plugins/jev/README.md)** — ID `jev`, directory `plugins/jev`.
  Experimental attention signals with inspectable, revision-linked evidence.
  Attention, capture, live evaluation, and automatic checks all start off.
  For a first demo, enable attention in settings and replay a fixture on the
  **Jev Attention** page; offline fixtures need no API key and are not measured
  predictions. Live evaluation separately requires Vercel AI Gateway access,
  a securely configured key, project selection, and a supported retention policy.
  Explain what visible conversation excerpts it sends before enabling live work.
- **[Cursor SDK](plugins/cursor-sdk/README.md)** — ID `cursor-sdk`, directory
  `plugins/cursor-sdk`. Local Cursor conversations with BB tools, streaming,
  model/reasoning controls, and optional Cursor Cloud execution. Requires the
  documented Personal/Work Cursor credentials; it does not use an arbitrary
  ambient Cursor login. macOS Keychain account labels and Linux key-file paths
  currently follow the author's bootstrap conventions, so verify these before
  offering it as ready to use. Install the runtime through **Settings → Providers**
  on each execution host, then select **Cursor SDK** in a new thread. Full access
  is the supported permission mode. Cloud also needs a clean, pushed GitHub
  commit and Cursor repository access; local BB tools and credentials are not
  forwarded. The cloud switch changes the default for new conversations only.
- **[Profiles](plugins/profiles/README.md)** — ID `profiles`, directory
  `plugins/profiles`. Switches between already configured Personal and Work BB
  instances, with separate accounts, thread history, and plugin settings. This
  is specialized deployment tooling: it assumes `.bb`/`.bb-work`, account-specific
  Cursor launchers, and the documented bootstrap/service conventions. It also
  restricts providers to its supported set and conflicts with the bundled ACP
  provider's Cursor registration. Installing it does not create a second instance.
  Only use it for a matching deployment; configure the user's own addresses in
  **Settings → Installed plugins → Profiles** and try switching there.

## Configure and verify

After installation, inspect each selected ID:

```sh
"$BB_PLUGINS_BB" plugin source hide-models --json
"$BB_PLUGINS_BB" plugin list --json
"$BB_PLUGINS_BB" plugin config hide-models
"$BB_PLUGINS_BB" plugin logs hide-models -n 50
```

Check that the source points to the user's permanent copy and the plugin
is enabled and running. Some settings are in custom plugin pages rather than
`plugin config`; use the linked README. After CLI configuration changes, reload
when required by the plugin. Refresh the browser if its UI remains stale. Start
or resume the agent session to discover newly contributed tools and skills.

Try the first-use action from the tour. For UI plugins, inspect the actual BB
interface with browser/computer tools when available; if unavailable, say that
visual verification remains for the user. A successful build alone does not
verify activation, credentials, or UI behavior. Do not merge PRs, create paid
model requests, or archive real work solely to demonstrate installation.

## Maintain your copy

Make changes in the user's repository. If a later upstream change is useful,
compare it against the recorded source revision, review its assumptions and
dependencies, and port only what the user wants. Preserve local customizations;
do not pull or merge upstream wholesale. There is no compatibility guarantee
or supported migration sequence.

After editing the copy, rebuild and verify the affected plugins:

```sh
git status --short
vp install --frozen-lockfile
"$BB_PLUGINS_BB" plugin build plugins/hide-models
"$BB_PLUGINS_BB" plugin reload hide-models
"$BB_PLUGINS_BB" plugin list --json
```

When intentionally changing dependencies, update the user's lockfile first.
Repeat build/reload/verification for every installed plugin affected by the
update, including shared dependency changes.
Do not reload a failed build or report the old running instance as the new one.

Use the user's own deployment process. The author's Personal/Work refresh
workflow is specialized maintainer tooling, not a requirement for copied plugins.

## Disable, remove, or troubleshoot

Disable a plugin to unload it while preserving its configuration:

```sh
"$BB_PLUGINS_BB" plugin disable hide-models
# Re-enable it later:
"$BB_PLUGINS_BB" plugin enable hide-models
```

If the user requests removal, explain that `bb plugin remove <id>` deletes its
settings, secrets, and schedules. It leaves local source files on disk. Keep the
source directory while any other installed plugin still points to it.

| Problem                                         | Next step                                                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| npm rejects `catalog:`                          | Use the root `vp install --frozen-lockfile` and local path install, not a direct Git install.                                     |
| `--plugin` cannot find a name                   | Use the tour's directory with `--subdirectory`; not every plugin is in the collection index.                                      |
| BB cannot find the source path                  | Verify the checkout exists on the server machine, not just the agent's execution host.                                            |
| Frozen dependency installation fails            | Check the pinned toolchain, registry/network error, and checkout consistency; preserve the lockfile and report the cause.         |
| A build fails or BB reports an incompatible SDK | Check the plugin's engine requirements and build output. Do not rewrite manifests or patch BB to bypass it.                       |
| Plugin installed but its UI is missing          | Check enabled/running state, logs, and the selected Appearance slot; reload the browser after a successful build/reload.          |
| Tools or presets are missing                    | Start or resume the agent session after installation/configuration.                                                               |
| Credentials or profile setup are missing        | Follow that plugin's prerequisites; report the missing setup without copying the author's accounts or enabling unrelated plugins. |

When source changes are needed, use the development checks in [README.md](README.md).
For installation alone, dependency installation, selected builds, activation
checks, and a feature walkthrough are sufficient.
