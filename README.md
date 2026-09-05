# bb-plugins

Lucas Netto's bb plugins.

Each plugin lives in `plugins/<name>` with its own package manifest.
A pnpm workspace manages dependencies with one root lockfile.
`.bb/plugins.json` indexes the collection for bb.

| Plugin | Purpose |
| --- | --- |
| cursor-account-labels | Distinguish work and personal Cursor providers. |
| hide-models | Hide selected models from the model picker. |
| multirepo | Browse files, changes, and pull requests across repositories. |
| t3-sidebar | Display a T3-style thread sidebar. |

## Development

Use Node.js 24+ and pnpm 11.7.0 (pinned in `package.json`). Install dependencies
from the repository root:

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Build or check one plugin with a filter:

```sh
pnpm --filter bb-plugin-hide-models build
pnpm --filter bb-plugin-multirepo test
```

For CI or a reproducible install, use `pnpm install --frozen-lockfile`.

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
`catalogMode: strict` keeps `pnpm add` on the catalog's shared versions.
To upgrade a dependency, edit its catalog entry and run `pnpm install`, then
run the build, typecheck, and test commands above. The shared BB SDK is pinned
to `0.4.47`; keep each plugin's `engines.bbPluginSdk` floor in sync when upgrading.
If `bb plugin types` rewrites dependency pins, move those versions into the
catalog and restore the manifest's `catalog:` references before installing.

## Distribution

Develop and install locally from this workspace after `pnpm install` and
`pnpm build`. For npm releases, build first and use `pnpm pack` or
`pnpm publish`: pnpm replaces catalog references with ordinary versions in
the published package. For example, from the root:

```sh
pnpm --filter bb-plugin-hide-models pack --pack-destination /tmp/bb-plugins-packages
```

Direct BB Git installs of these source manifests are unsupported: BB runs
`npm install` for Git plugins, and npm cannot resolve `catalog:`. Distribute
packed npm releases or use the local checkout workflow above.

Generated bundles, dependencies, and local configuration stay out of Git.
