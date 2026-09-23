# Orbisa architecture

`server.ts` registers a single machine/environment provider and the bounded
`bb orbisa machines` command. `provider.ts` journals allocation intent, delegates
to host RPC, prepares the profile and calls the public SDK bootstrap helper.
`contract.ts` validates transport inputs; `host.ts` validates the host platform
and executes the installed Orbisa CLI with bounded output and private stdin.
`profile.ts` installs the matching agent runtime and temporary credentials.
`policy.ts` stops archived machines and deletes them after ten minutes, with
restart recovery, ownership rechecks and cancellation on unarchive.

All Incus and OrbStack lifecycle operations live in the independent Orbisa CLI.
No BB core imports or internal enrollment implementations are used.
