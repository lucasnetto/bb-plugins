# bb-plugins

Lucas Netto's bb plugins.

Each plugin lives in `plugins/<name>` with its own package manifest.
A pnpm workspace manages dependencies with one root lockfile.
`.bb/plugins.json` indexes the collection for bb.

| Plugin                | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| cursor-account-labels | Distinguish work and personal Cursor providers.               |
| hide-models           | Hide selected models from the model picker.                   |
| multirepo             | Browse files, changes, and pull requests across repositories. |
| t3-sidebar            | Display a T3-style thread sidebar.                            |

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
vp test --project multirepo
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
