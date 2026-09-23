Resume work after BB has removed a thread’s workspace. Open **Recover workspace**
on the old thread, choose its surviving Git branch, and create a fresh worktree
with a continuation conversation.

## How it works

The plugin defaults to the recorded branch. You can select another local or
remote branch when needed. The continuation receives the original request and
recent saved messages, keeps the original execution settings, and links back to
the complete conversation. Its first reply summarizes progress and waits for you.
Repeated requests reuse the recorded recovery thread.

## Requirements and limits

The original machine must be online with its project checkout, the Worktree
provider, and the selected Git branch available. Only committed files are
recovered. Uncommitted edits, attachment contents, and native agent state are not
restored. The original thread remains intact. This plugin requires Plugin SDK
0.5.9 or later and uses public APIs only.

Agents can inspect a source with `bb environment-recovery preview` and create a
continuation with `bb environment-recovery recover`.
