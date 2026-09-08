Switch between your Personal and Work bb instances from the sidebar footer. Each instance keeps its own threads and provider accounts; switching pages leaves running work alone.

## Accounts

Personal uses the existing Codex home and the Personal Cursor API key from macOS Keychain. Work uses `~/.codex_work` on the Mac and the Work Codex login on its Orbisa machines. Its `bb-cursor-work-acp` launcher uses a dedicated Work API key: macOS Keychain on the Mac and a mode-0600 file on the VMs. Both launchers fail if their key is unavailable. The plugin reuses BB's public Cursor ACP bridge and preserves the old Personal Cursor provider ID for existing conversations.

## Setup

This installation is configured for `~/.bb` and `~/.bb-work`, with separate server and daemon services. Disable the bundled ACP provider before enabling this plugin, because both register Cursor. The profile is determined by the instance's data directory and cannot be changed by the selector. Local clients switch between loopback addresses; remote clients switch between the two authenticated bb Connect addresses.

Work discovers its model list through the authenticated ACP session, because Cursor’s CLI model list can advertise a `default` alias that its ACP model selector rejects. Install its launcher and key with the sibling Orbisa repository’s `scripts/install-bb-work-cursor`.
