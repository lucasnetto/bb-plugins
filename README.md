# bb-plugins

Lucas Netto's bb plugins.

Each plugin lives in `plugins/<name>` with its own package manifest.
A pnpm workspace manages dependencies with one root lockfile.
`.bb/plugins.json` indexes the collection for bb.

| Plugin                | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| cursor-account-labels | Distinguish work and personal Cursor providers.               |
| bb-fonts           | Choose interface and code fonts with live previews.           |
| hide-models           | Hide selected models from the model picker.                   |
| pr-review             | Find PRs, review code with agents, and settle completed work. |
| t3-sidebar            | Display a T3-style thread sidebar.                            |
| workers               | Inspect hidden child workers and chat in the parent panel.    |

## Development

Use Node.js 24+ and the Vite+ CLI (`vp`). The workspace pins Vite+ 0.3.0
through the catalog and pnpm 11.7.0 as its package manager. From the root:

```sh
vp install
vp run build
vp check
vp test
```

Build or check one plugin with a filter:

```sh
vp run --filter bb-plugin-hide-models build
vp test --project pr-review
```

`vp check` runs Oxfmt, Oxlint, and type checking together. Use `vp fmt` to
format, `vp lint` to lint, or `vp run typecheck` for types only. Configuration
lives in the root `vite.config.ts`; test projects have their own
`plugins/<name>/vite.config.ts`. Tests import Vitest APIs from `vite-plus/test`.
T3 tests run against source, so tests do not require a preceding build.

`vp run build` orchestrates `bb plugin build` for every plugin. BB's builder
produces required plugin artifacts and metadata, so use this command instead
of the built-in Vite application command `vp build`. Likewise, `vp pack` is a
library builder; use `pnpm pack` for release tarballs as shown below.

For CI or a reproducible install, use `vp install --frozen-lockfile`.

From the repository root, install that plugin into bb:

```sh
bb plugin install path:. --plugin hide-models
```

Repeat for each plugin you want to run from this checkout. Installing changes
its registered source to this checkout. The initial source import does not
change existing installations.

## Isolated UI testing

Use BB's **Browser Automation** plugin with `--backend local --headless`.
Each test gets its own bb instance and Chrome profile, so tests can run
concurrently without opening a window or taking over the user's browser.

`scripts/bb-test.py` delegates startup and shutdown to `bb-app start/stop`.
It allocates a temporary data directory and two loopback ports, waits for the
server and daemon to be ready, then builds and installs the requested plugins:

```sh
python3 scripts/bb-test.py start --plugin plugins/fonts
```

Keep the returned JSON's `directory` and `url`. Repeat `--plugin` for multiple
plugins. The default runtime is the installed macOS `/Applications/bb.app`;
use `--runtime /path/to/bb/packages/bb-app` for a separate built runtime.

**Runtime prerequisite:** the installed BB 0.42.1 did not include Browser
Automation when checked on September 9, 2026. It ships SDK 0.4.47; this plugin
requires SDK 0.4.48 and its browser API, so installing the plugin alone is
insufficient. The workflow was verified with
[upstream commit `9f99314`](https://github.com/get-bb/bb/tree/9f99314bbeb00114cd520c5b212b61f896d82e0e).
To prepare that runtime separately (Node.js, npm, Git and Chrome required):

```sh
git clone https://github.com/get-bb/bb /tmp/bb-ui-runtime
git -C /tmp/bb-ui-runtime checkout 9f99314bbeb00114cd520c5b212b61f896d82e0e
cd /tmp/bb-ui-runtime
npm exec --yes --package=pnpm@9.15.0 -- pnpm install --frozen-lockfile --ignore-scripts
npm exec --yes --package=pnpm@9.15.0 -- pnpm exec turbo run build --filter=bb-app --concurrency=2
node scripts/ensure-native-modules.mjs
```

Back in this checkout, start with
`python3 scripts/bb-test.py start --runtime /tmp/bb-ui-runtime/packages/bb-app --plugin plugins/fonts`.
This does not replace the installed app. A shell sandbox may prevent Chrome
from starting; in that case, request execution outside that sandbox for the
**temporary launcher**, keeping the same isolated data and headless mode.

For the remaining commands, set `test_dir` to the returned directory:

```sh
test_bb() { python3 scripts/bb-test.py bb "$test_dir" "$@"; }
python3 scripts/bb-test.py status "$test_dir"
test_bb plugin install browser-automation --yes --json
test_bb machine list --json
```

Browser sessions need an owner thread on the **test instance**. Use an existing
test thread, or create an empty fixture by scheduling a prompt far in the future
and immediately removing that queued message. No agent needs to run:

```sh
test_bb thread spawn --project proj_personal --provider codex \
  --title "Browser QA fixture" --prompt "Browser ownership fixture" \
  --send-at 2099-01-01T00:00:00Z --json
test_bb thread queue list <test-thread-id> --json
test_bb thread queue delete <test-thread-id> <queued-message-id> --json
```

Use that thread ID and the host ID returned by `machine list`, then retain the
session ID returned by `open`:

```sh
test_bb browser-automation open --backend local --headless \
  --machine <test-host-id> --thread <test-thread-id> --json
test_bb browser-automation run <session-id> --thread <test-thread-id> \
  --script 'const p = await browser.getPage("main"); await p.goto("<test-url>"); await p.snapshot()' --json
test_bb browser-automation run <session-id> --thread <test-thread-id> \
  --script 'const p = await browser.getPage("main"); await p.click("ref/e6"); await p.snapshot()' --json
test_bb browser-automation screenshot <session-id> --thread <test-thread-id> --page main --json
```

Replace the example click ref with one from a fresh snapshot. Pages may still
be loading after navigation; inspect again before choosing refs. Screenshot
results contain local image paths: read or copy the images before closing the
session. The first browser open installs BB's pinned DevBrowser runtime into
the temporary instance and needs network access. Later opens reuse it.

The wrapper clears inherited BB routing and credential environment variables;
all test commands must go through it. Use absolute plugin/project paths in
wrapper commands, since their working directory is the temporary instance.
Continue running the agent itself in its original instance. To rebuild a plugin:

```sh
test_bb plugin build "$PWD/plugins/fonts"
test_bb plugin reload bb-fonts
```

Give each concurrent test its own instance and browser session. Use separate
worktrees when tests need different builds of the same plugin. Settings,
plugin registrations, threads, databases and browser cookies are separate.
The operating-system user, filesystem and provider logins on disk are shared;
this is not a VM. Ask before using a visible browser or the user's active window.

Always close the session and stop the instance in cleanup, including on failure:

```sh
test_bb browser-automation close <session-id> --thread <test-thread-id> --json
python3 scripts/bb-test.py stop "$test_dir"
```

Browser sessions have BB's five-minute idle and thirty-minute absolute expiry.
The bb instance has **no automatic expiry**. `stop` uses BB's process ownership
checks and confirms both ports are closed before removing the temporary data.
Run cleanup outside the shell sandbox too if it prevents process inspection.
Use `stop <directory> --keep` to
retain logs and data. Startup failures also retain diagnostics; remove them
with `stop <directory>` after inspection. No persistent service is installed.

The Profiles plugin needs a separate fixture: its selector points at the live
Personal and Work URLs and expects `.bb`/`.bb-work` directory names. The launcher
rejects it explicitly.

Run the launcher's isolation checks with
`python3 -B -m unittest discover -s scripts/tests -v`.

## Dependencies

All direct dependency versions live in the default `catalog` in
`pnpm-workspace.yaml`. Plugin manifests use `catalog:` references, and
`catalogMode: strict` keeps `vp add` on the catalog's shared versions.
To upgrade a dependency, edit its catalog entry and run `vp install`, then
run the build, typecheck, and test commands above. The shared BB SDK is pinned
to `0.4.47`; keep each plugin's `engines.bbPluginSdk` floor in sync when upgrading.
If `bb plugin types` rewrites dependency pins, move those versions into the
catalog and restore the manifest's `catalog:` references before installing.

## Distribution

Develop and install locally from this workspace after `vp install` and
`vp run build`. For npm releases, build first and use `pnpm pack` or
`pnpm publish`: pnpm replaces catalog references with ordinary versions in
the published package. For example, from the root:

```sh
pnpm --filter bb-plugin-hide-models pack --pack-destination /tmp/bb-plugins-packages
```

Direct BB Git installs of these source manifests are unsupported: BB runs
`npm install` for Git plugins, and npm cannot resolve `catalog:`. Distribute
packed npm releases or use the local checkout workflow above.

Generated bundles, dependencies, and local configuration stay out of Git.

## Source layout

Each plugin keeps its manifest and tooling configuration at the package root:

```text
plugins/<name>/
  package.json
  components.json
  tsconfig.json
  vite.config.ts       # plugins with tests
  src/
    ui/                # app.tsx, components, hooks, browser helpers
    server/            # server.ts, host.ts when needed, Effect operations
    shared/            # RPC schemas, types and constants, when needed
  tests/               # mirrors src/, e.g. server/server.test.ts
    server/
    ui/
```

UI and server code import contracts from `src/shared`; neither imports the
other's implementation, even for types. Shared modules do not depend on UI or
server implementations. Tests live in a sibling `tests/` tree mirroring `src/`
(e.g. `tests/ui/app.test.tsx` and `tests/server/lib/project-settings.test.mjs`).
Test discovery is limited to `tests/`, which is included in type checking. `@/` resolves
to `src/`, including the shadcn aliases (`@/ui/components`, `@/ui/lib`, etc.).
BB entry points in each manifest point directly into `src/`. Generated `dist/`
artifacts and agent `skills/` retain their existing locations.

## Backend convention

All backend operations return Effect v4 values, including CRUD, thread
forwarding, CLI workflows, HTTP reads, events and background work. Convert to
Promises only at BB entry points. Native/SDK adapters wrap foreign promises in
`Effect.tryPromise`; pass cancellation signals when the underlying API supports
them. Backend operations compose other operations directly, never Promise
handlers. Plugin-owned runtimes are disposed on reload.

Pure helpers, schemas, manifest/registration declarations and frontend code
remain ordinary TypeScript. Use the workspace-pinned Effect version and verify
its installed APIs; this repository currently pins `4.0.0-rc.112`.
