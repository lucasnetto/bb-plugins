# bb-plugins

My personal collection of [BB](https://getbb.app/) plugins. I build these for
my own setup and share the source for anyone who finds it useful.

Use them shadcn-style: copy the plugins you want into a repository you own,
adapt them to your setup, and maintain your copy. I won't publish packages or
marketplace releases, and I don't promise support or backwards compatibility.
Plugin IDs, settings, behavior, and BB/SDK requirements can change whenever
my setup needs them to.

The Orbisa integration now lives in the
[Orbisa repository](https://github.com/lucasnetto/orbisa/tree/main/plugins/bb).
Its README covers installation and moving an existing `orbisa` plugin source
while retaining configuration and machine state.

## Set up with your agent

Give your coding agent this prompt:

> Read https://github.com/lucasnetto/bb-plugins/blob/main/INSTALL.md. Walk me through
> the plugins and their features, help me choose which ones fit my setup, then
> copy the selected source and its dependencies into a permanent repository
> I own. Adapt it to my setup, build and install my copies, and verify them
> in BB. Treat upstream as reference code, with no compatibility guarantees
> or automatic updates. Explain any plugin that needs additional setup.

[INSTALL.md](INSTALL.md) is the agent-facing installation guide and plugin tour.
It also covers configuration, maintaining your copy, troubleshooting, and removal. You can
follow it yourself with the same commands.

## Plugins

Each plugin lives in `plugins/<name>` with its own package manifest.
A pnpm workspace manages dependencies with one root lockfile.
`.bb/plugins.json` indexes a subset of this collection for BB. Install your
copies by directory path; you don't need to copy that index.

| Plugin                                                         | Purpose                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [bb-fonts](plugins/fonts/README.md)                            | Choose interface and code fonts and sizes, with live previews.                |
| [ocean-theme](plugins/ocean-theme/README.md)                   | Use T3 Code's Ocean palette in light or dark mode.                            |
| [hide-models](plugins/hide-models/README.md)                   | Hide selected models from the model picker.                                   |
| [model-thinking-level](plugins/model-thinking-level/README.md) | Keep the thinking level visible beside the model.                             |
| [t3-sidebar](plugins/t3-sidebar/README.md)                     | Organize threads with cards, pinning, snoozing, and a Settled shelf.          |
| [pr-review](plugins/pr-review/README.md)                       | Find and review PRs, generate guided reviews, and inspect local changes.      |
| [rename-thread](plugins/rename-thread/README.md)               | Regenerate thread titles from conversation context.                           |
| [workers](plugins/workers/README.md)                           | Delegate to hidden workers and chat with them in the parent panel.            |
| [workspace-opener](plugins/workspace-opener/README.md)         | Open a folder's workspace file in Cursor or VS Code.                          |
| [environment-recovery](plugins/environment-recovery/README.md) | Continue a conversation in a fresh worktree after its environment is removed. |
| [jev](plugins/jev/README.md)                                   | Explore attention signals and their evidence, with optional live evaluation.  |
| [cursor-sdk](plugins/cursor-sdk/README.md)                     | Run Cursor locally with BB tools or on Cursor Cloud.                          |
| [profiles](plugins/profiles/README.md)                         | Switch between separately configured Personal and Work BB instances.          |

Cursor SDK and Profiles currently depend on specific profile and
credential conventions. Read their prerequisites in the
[plugin tour](INSTALL.md#plugin-tour) before selecting them.

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

`vp run build` orchestrates `bb plugin build` for packages with a build script.
To build any plugin directly, including Ocean Theme, use
`bb plugin build plugins/<directory>`. BB's builder produces required plugin
artifacts and metadata; the Vite application command `vp build` does not.

For CI or a reproducible install, use `vp install --frozen-lockfile`.

From the repository root, install that plugin into bb:

```sh
bb plugin install path:. --subdirectory plugins/hide-models
```

These development commands describe this repository's tooling. For a selected
copy, keep only the test projects and configuration you need. Follow
[INSTALL.md](INSTALL.md) to install from your own source directory.

## Dependencies

All direct dependency versions live in the default `catalog` in
`pnpm-workspace.yaml`. Plugin manifests use `catalog:` references, and
`catalogMode: strict` keeps `vp add` on the catalog's shared versions.
To upgrade a dependency, edit its catalog entry and run `vp install`, then
run the build, typecheck, and test commands above. The shared BB SDK is pinned
to `0.5.29`; keep each plugin's `engines.bbPluginSdk` floor in sync when upgrading.
If `bb plugin types` rewrites dependency pins, move those versions into the
catalog and restore the manifest's `catalog:` references before installing.

## Distribution

Copy the source you want, including its dependencies, SDK patches, and license
notices, into your own repository. Follow [INSTALL.md](INSTALL.md) to build
your copy and register its local path with BB. Keep that directory available
for as long as the plugins are installed.

Upstream is a reference, not an update channel. Review later changes and port
the ones you want; there is no release schedule or supported upgrade path.
Direct BB Git installs also can't resolve this workspace's `catalog:`
dependencies. Use local path installs from your own copy.

Generated bundles, dependencies, and local configuration stay out of Git.

## License

Original code is licensed under the [MIT License](LICENSE). Third-party code
retains its own notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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
