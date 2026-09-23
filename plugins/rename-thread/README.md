# Rename Thread

Right-click a thread in T3 Sidebar and choose **Regenerate title**. The menu shows
**Regenerating…** while the selected provider creates a title. A toast reports
success or failure. The active conversation receives no messages or extra turns.

Generation uses up to 8,000 characters of conversation text, preserving up to
2,000 characters of the original user request plus recent user and assistant
messages. Tools, reasoning and system events are excluded. Images are not sent
in this first version. The prompt focuses on the durable user goal and includes
the current title.

For Codex, the helper runs on the BB server machine, in a temporary directory, with
`codex exec --ephemeral --sandbox read-only`, structured JSON output, the selected
reasoning level and a 60-second timeout. Codex must be on the server's PATH. The BB data directory determines the login: `.bb` uses `~/.codex` and
`.bb-work` uses `~/.codex_work`. Unknown profiles fail instead of inheriting
another account's login. Authentication is handled by Codex; this plugin never reads
credential files. The model picker in the plugin settings uses BB's live provider
catalog and defaults to Codex `gpt-5.6-luna` with low reasoning. Provider, model,
reasoning and service tier are stored in this BB profile.

Other providers run through a hidden BB helper in a separate personal workspace
on the primary machine, matching the settings picker's catalog. They use this
profile's provider authentication and have a 120-second generation timeout.
Helpers are stopped and archived after success, failure, or plugin reload.
The target thread's workspace and provider do not need to match the title model.

The plugin rechecks the current title immediately before updating it and drops
results if a manual rename occurred during generation. The SDK does not offer
an atomic conditional title update, so a simultaneous rename in the brief gap
between that read and write cannot be fully guarded. Repeated clicks while a job
is running do not start another call. Reloading the plugin interrupts generation.

The optional T3 Sidebar integration hides the action when this plugin is absent
or disabled. BB's built-in sidebar does not expose a context-menu extension hook.

CLI equivalents:

```sh
bb rename-thread start <thread-id>
bb rename-thread status <thread-id>
bb rename-thread model [model-id]
```

Status is transient and bounded; after server reload it returns to `idle`.
Install from the permanent bb-plugins checkout and refresh using the Profiles helper.
