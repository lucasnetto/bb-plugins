---
name: workspace-opener
description: Diagnose workspace-file selection for BB’s existing Open in Cursor or VS Code action.
---

# Workspace Opener

The plugin chooses a folder’s single direct `.code-workspace` file. No settings or
commands are required. Multiple files, missing files, and lookup failures leave the
folder unchanged. Cursor and VS Code are supported; terminal/Finder opens are unchanged.

For diagnosis, inspect `bb plugin logs workspace-opener` and confirm the owning
machine is enrolled in the current profile. The frontend wraps the internal local
helper `/open-in-target` request; BB updates can require an adapter update.
Refresh both profiles from the permanent bb-plugins checkout using
`bb profiles refresh workspace-opener`, then `bb profiles refresh workspace-opener --check`.

Local Cursor opens explicitly pass `--classic` to open the IDE, including file/line
targets. Local launch errors never fall back to Glass. SSH requests still use BB’s
launcher. On macOS the plugin looks for Cursor.app in system or user Applications.
