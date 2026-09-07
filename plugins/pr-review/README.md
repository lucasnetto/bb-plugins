# PR Review

A GitHub PR page inspired by [t3code's pull requests page](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/routes/_chat.pull-requests.tsx), using Multirepo's existing review threads and linked-PR panels.

- **Created by me** is the default: all open PRs authored by the current GitHub user, including drafts.
- **Review requested** includes open requests to the user and their teams. GitHub's `review-requested:USERNAME` qualifier resolves team membership; no separate organization-membership scan is needed. Completed review requests disappear according to GitHub's search semantics.
- Results span accessible GitHub repositories, ordered by update time. Load more fetches 50 at a time. The text filter searches loaded results. GitHub's partial results and 1,000-result cap are disclosed.
- **Review in thread** invokes Multirepo's `reviewUrl` RPC, creates a review thread in its umbrella workspace, links the PR with `requested-review`, and opens its existing review panel. Repositories do not need to be cloned to appear or to review their GitHub diff. Review prompts preserve the shared checkout and do not authorize posting to GitHub.

## Setup

Install both plugins from this collection, and select a Workspace project in Multirepo's settings. On that project's machine, install `gh` and sign in with `gh auth login --hostname github.com`. The page uses that machine's current GitHub account, including when bb runs remotely. This version supports github.com.

```sh
pnpm install --frozen-lockfile
pnpm --filter bb-plugin-multirepo build
pnpm --filter bb-plugin-pr-review build
bb plugin install path:. --plugin multirepo
bb plugin install path:. --plugin pr-review
```

Open **Pull requests** in bb's navigation. The older Multirepo PR inbox remains available for browsing PRs by local repository.

## Integration contract

Uses only public SDK calls. The server calls `bb.sdk.plugins.callRpc` on `multirepo`:

- `workspace(null)` → `{root, hostId, projectId, name}` selects the machine for GitHub requests.
- `reviewUrl({url})` → `{threadId, warning}` creates the review and links the PR. A link failure returns the created thread with a warning so the user can recover without creating a duplicate agent run.

The frontend stores the canonical URL in `sessionStorage` under `bb:multirepo:open-review:<threadId>` before `navigate.toThread(threadId)`, following Multirepo's browser integration protocol. Multirepo consumes it on thread-header mount.

Tests cover query semantics, pagination/limits, validation/auth failures, remote-host routing, Multirepo delegation, and the page-to-thread handoff. Run `pnpm exec vp test --project pr-review`.
