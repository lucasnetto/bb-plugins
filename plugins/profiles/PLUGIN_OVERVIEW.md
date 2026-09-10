Switch between your Personal and Work bb instances using the profile icons above New thread. The active profile is highlighted; hover an icon to see its name. The sidebar footer and plugin settings also offer the full profile selector. Each instance keeps its own threads and provider accounts; switching pages leaves running work alone.

## Accounts

Personal uses the existing Codex home and the Personal Cursor API key from macOS Keychain. Work uses `~/.codex_work` on the Mac and the Work Codex login on its Orbisa machines. Its `bb-cursor-work-acp` launcher uses a dedicated Work API key: macOS Keychain on the Mac and a mode-0600 file on the VMs. Both launchers fail if their key is unavailable. The plugin reuses BB's public Cursor ACP bridge and preserves the old Personal Cursor provider ID for existing conversations.

## Setup

This installation is configured for `~/.bb` and `~/.bb-work`, with separate server and daemon services. Disable the bundled ACP provider before enabling this plugin, because both register Cursor. The profile is determined by the instance's data directory and cannot be changed by the selector. Local clients switch between loopback addresses; remote clients switch between the two authenticated bb Connect addresses.

Both profiles discover models and thinking levels through their authenticated launcher's `--list-models` command. Work omits Auto because its account rejects that alias over ACP. Personal retains Auto. The selected effort is applied to Cursor's effort setting, including its separate thinking on/off toggle. Install the Work launcher and key with the sibling Orbisa repository’s `scripts/install-bb-work-cursor`.

Choose Profiles under Settings → Appearance → Navigation if another navigation replacement is selected. The profile row keeps BB’s standard navigation and works alongside a custom thread list.

Switching profiles restores the last thread visited in that profile on this browser. Each profile stores its own last thread locally. If no thread has been remembered, the profile opens New thread; opening New thread directly never restores an old thread.
