# Orbisa for BB

The plugin runs each environment through the independent [Orbisa Go CLI](https://github.com/lucasnetto/orbisa).
Use Incus on a Linux runtime host or OrbStack on a Mac. The BB server may be on a
different host: typed host RPC executes the CLI where the runtime lives.

Install Orbisa 0.2.0 on the runtime host's PATH and build its clean tooling image.
Then create a machine with the `orbisa-machine` provider:

```sh
bb machine create --provider orbisa-machine --inputs '{"runtimeHostId":"HOST_ID","backend":"orbstack"}'
bb machine create --provider orbisa-machine --inputs '{"runtimeHostId":"HOST_ID","backend":"incus"}'
```

The composition `orbisa-machine` allocates a machine and uses BB's
`project-checkout` provider. Core prepares the Git checkout on the new host.
The optional `image` input defaults to `orbisa-tooling-v1` on OrbStack and
`orbisa-tooling-v2` on Incus. Both use two CPUs and 2GiB by default.
`bb orbisa machines` shows lifecycle and cleanup deadlines.

The adapter checkpoints the transport destination before allocation and the
Orbisa resource ID before SDK bootstrap. Recovery uses the same owner/key;
credentials and enrollment payloads travel through private stdin and are never
stored in resource JSON or images. The profile's Codex login is installed in
tmpfs, with the server's exact Codex version. GitHub, npm GitHub Packages, optional
AWS credentials and the dedicated Git signing identity are prepared on create
and wake. BB supplies its global skills and provider configuration normally.
The tooling image contains no editor or agent account.

Archiving/settling the last owning thread immediately requests suspension.
Ten minutes after settlement, all files are deleted through BB's lifecycle
coordinator. Unarchive before that deadline to cancel deletion. A completed
agent turn alone does not stop a machine. Hidden threads count as owners.
Policy state survives reload; startup recovery and a minute schedule retry
interrupted cleanup. Standalone machines without archived thread ownership
remain until explicitly removed.

Commit and push before settling. Removal discards uncommitted files, unpushed
commits and ignored data. Create a new environment from the branch after removal.
Stop/start retains files but does not restore processes; enabled services must
restart on boot. Use `bb connect expose PORT` inside the environment's thread
for its independent preview URL.

Version 0.3 replaces the old direct-OrbStack task/persistent providers and the
separate Incus provider. It has no fixed slots, prepared BB caches, host mounts,
or legacy machine adoption. Remove old machines with their old provider loaded,
then install this version and recreate environments. Orbisa owns runtime
lifecycle; this plugin owns BB enrollment, profile preparation and archive policy.

Run the package's tests, TypeScript checks, and `bb plugin build` before release.
From the permanent bb-plugins checkout, finish local installation with
`bb profiles refresh orbisa` and `bb profiles refresh orbisa --check`.

## Settings

**AWS region** is the only deployment preference on the Orbisa plugin page.
The profile bootstrap determines credential locations: Personal uses `~/.codex`,
Work uses `~/.codex_work`, and optional signing uses `~/.config/orbisa/signing_key`.
The BB data directory selects the profile; unknown profiles fail before reading
credentials. An absent signing key leaves Git signing off. These implementation
paths are conventions, not editable settings. Credentials stay in private files.
