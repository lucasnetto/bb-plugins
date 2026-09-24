# Installing and using bb-plugins

- For installation, plugin selection, feature walkthroughs, updates, or removal, read [INSTALL.md](INSTALL.md). Follow its local checkout workflow and the selected plugins' READMEs.
- The Personal/Work refresh workflow below is for maintaining the author's configured deployment. A new user's installation does not require Profiles or a second BB instance.

# Plugin development workflow

- Never modify bb core, including its source or installed bundles. Implement changes through plugins; if the plugin API cannot support a feature, explain the limitation.
- When finishing work on a plugin, always run `bb profiles refresh <plugin-id>` from the permanent bb-plugins source to refresh it in both Personal and Work. Use `bb profiles refresh <plugin-id> --check` to inspect installation paths, build versions, and health. This is the supported administrative exception to profile isolation; do not manually change `BB_SERVER_URL` or provider credentials. Never install a plugin from a disposable worktree. If the work includes UI changes, test the UI with computer use.
