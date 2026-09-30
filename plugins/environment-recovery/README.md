# Environment Recovery

Restore a removed workspace on its original thread with BB 0.44 or later.
The recorded branch keeps the complete conversation, thread identity and execution
settings. An archived thread is unarchived before restoration. Restoration starts
no agent turn and does not restore uncommitted files.

For another branch or a provider without native restoration, create a fresh Git
worktree and continuation. A new continuation thread receives the original request and
recent saved messages, retaining the source provider, model, reasoning, service
tier, and permission mode. Its first reply summarizes progress and waits.

Open **Recover workspace** in the old thread’s header or panel launcher. Review
the branch, optionally enter another local or remote branch, and choose **Restore this thread**. For another branch, choose **Create
recovery**. Open the returned thread while BB prepares its new environment.

```sh
bb environment-recovery preview <thread-id> --json
bb environment-recovery recover <thread-id> --branch origin/my-feature --json
```

A continuation leaves the source thread intact, even when archived. Recovery uses the original
machine and project checkout through the public Worktree provider. That machine
must be online and the selected branch must exist; there is no implicit fallback
to the default branch. A fresh branch starts from its committed contents.

The original request is capped at 8,000 characters and recent messages at 40,000,
with a bounded history scan and explicit truncation marker. For continuations, native provider state,
uncommitted files, and attachment contents are not copied. The complete original
conversation remains linked in the new thread.

Requests for the same source environment and branch are serialized and recorded
in plugin storage to prevent duplicate workspaces, including across reloads. A
lost creation response blocks automatic retry because the thread may already
exist. Inspect the thread list before further recovery. A later removed recovery
workspace can itself be used as the source of another recovery.

## Development

Requires BB with Plugin SDK 0.5.9 or later. Run `vp test`, `tsc --noEmit`, and
`bb plugin build` from this package. Refresh only from the permanent bb-plugins source:
`bb profiles refresh environment-recovery --install-missing`, then
`bb profiles refresh environment-recovery --check`.
