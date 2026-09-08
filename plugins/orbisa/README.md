# Orbisa for bb

One bb server runs on the Mac. The Mac and three isolated Orbisa VMs are execution machines in that server. Select the `180seg` project, open **Environment**, and choose **Work in checkout** under the desired VM (or **Work locally** under the Mac). Each VM uses `/workspace/180seg`.

When a VM is stopped, bb disables its Environment choices. The plugin shows a **Wake 180seg-orbisa-0N** button above the new-thread composer. Click it, wait for the VM to connect, then select it from Environment. The button disappears once connected.

The plugin holds messages targeting a disconnected, bound VM while the existing Orbisa SSH ProxyCommand starts it and refreshes its volatile credentials. It starts the enrolled bb daemon, waits for it to connect, then releases queued messages. Simultaneous messages share one wake operation. A failed wake stays queued until `bb orbisa wake <slot>` retries it. Other machines are unaffected.

## Setup

1. Pair the Mac using `bb connect` and the getbb.app dashboard.
2. In Settings → Machines, generate the official remote-machine installer for the reachable bb connect URL, and run it inside each VM. It installs a host daemon under `~/.bb-machines/<server-host>` and a systemd user service with automatic updates. Existing Babashka `bb` is preserved.
3. Add each VM's `/workspace/180seg` as a source of the existing Mac `180seg` project:
   `bb project source add <project-id> --machine <host-id> --path /workspace/180seg`
4. Install this plugin on the Mac and bind each enrollment:
   `bb orbisa bind 180seg-orbisa-01 <host-id>` (repeat for 02 and 03).

The current setup uses `https://personal.example.com` and systemd service `bb-host-daemon-bb-plugins-getbb-app.service`. A different server handle requires updating the service name in `server.ts`.

## Commands

- `bb orbisa status`: inspect bindings without waking anything.
- `bb orbisa wake 180seg-orbisa-01`: wake or explicitly retry a failed wake.
- `bb orbisa bind <slot> <host-id>`: bind an enrolled machine whose name matches the slot.

Both Orbisa isolation flags remain enabled. VM-to-Mac bb traffic travels through authenticated bb connect; no Mac directories or SSH server are exposed. The Mac server and its internet connection must remain available. AWS SSO expiry is handled by the existing Orbisa refresh flow.

This replaces the earlier standalone bb instances and localhost gateways. Ports 38901–38903, `orbisa-bb.service`, `bb-orbisa`, and `~/.bb-orbisa` are obsolete and are not used by this plugin. T3, Cursor, repositories, and their credentials are independent.

## Development

Run `npm test`, the workspace TypeScript check, `bb plugin build orbisa`, and `bb plugin reload orbisa` after changes. The backend and frontend use the public plugin SDK. Disabling or reloading it aborts pending wake operations.
