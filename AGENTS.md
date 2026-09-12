# Plugin workflow

- Never modify bb core, including its source or installed bundles. Implement changes through plugins; if the plugin API cannot support a feature, explain the limitation.
- When finishing work on a plugin, always run `bb profiles refresh <plugin-id>` from the permanent bb-plugins source to refresh it in both Personal and Work. Use `bb profiles refresh <plugin-id> --check` to inspect installation paths, build versions, and health. This is the supported administrative exception to profile isolation; do not manually change `BB_SERVER_URL` or provider credentials. Never install a plugin from a disposable worktree. If the work includes UI changes, ask the user for permission before using computer use, then test the UI with computer use once permission is granted.
