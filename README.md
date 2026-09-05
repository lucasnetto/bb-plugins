# bb-plugins

Lucas Netto's bb plugins.

Each plugin lives in `plugins/<name>` with its own package manifest and lockfile.
`.bb/plugins.json` indexes the collection for bb.

| Plugin | Purpose |
| --- | --- |
| cursor-account-labels | Distinguish work and personal Cursor providers. |
| hide-models | Hide selected models from the model picker. |
| multirepo | Browse files, changes, and pull requests across repositories. |
| t3-sidebar | Display a T3-style thread sidebar. |

## Development

Install dependencies and build inside the plugin you want to change:

```sh
cd plugins/hide-models
npm ci
bb plugin build
```

From the repository root, install that plugin into bb:

```sh
bb plugin install path:. --plugin hide-models
```

Repeat for each plugin you want to run from this checkout. Installing changes
its registered source to this checkout. The initial source import does not
change existing installations.

Keep each plugin's dependencies and lockfile independent so it can be installed
on its own. Generated bundles, dependencies, and local configuration stay out
of Git.
