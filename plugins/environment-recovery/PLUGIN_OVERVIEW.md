Resume work after BB removes a thread’s workspace. On BB 0.44 or later, restore
the recorded branch on the original thread, keeping its full conversation. An
archived thread is unarchived first; restoration starts no agent turn.

## Alternate branches

Choose another local or remote branch to create a fresh worktree and continuation
conversation. This is also available on older BB versions and when the original
provider cannot restore its workspace. The continuation receives bounded saved
history and execution settings, and links to the original thread. Repeated
requests reuse its recorded recovery thread.

## Requirements and limits

The original machine must remain available. Only committed files are restored;
uncommitted edits and deleted files outside Git cannot be recovered. A continuation
requires the Worktree provider and a surviving Git branch, and does not copy
native agent state or attachment contents. Native restoration failures are shown
without silently creating a continuation.

Use `bb environment-recovery preview` to inspect recovery and
`bb environment-recovery recover` to request it. The plugin uses public APIs and
supports BB 0.43 with Plugin SDK 0.5.9 or later.
