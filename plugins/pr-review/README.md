# PR Review

A GitHub PR page inspired by [t3code's pull requests page](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/routes/_chat.pull-requests.tsx), using Multirepo's existing review threads and linked-PR panels.

- **Created by me** is the default: all open PRs authored by the current GitHub user, including drafts.
- Clicking a PR title opens it on GitHub.
- **Review requested** includes open requests to the user and their teams. GitHub's `review-requested:USERNAME` qualifier resolves team membership; no separate organization-membership scan is needed. Completed review requests disappear according to GitHub's search semantics.
- Results span accessible GitHub repositories, ordered by update time. Load more fetches 50 at a time. The text filter searches loaded results. GitHub's partial results and 1,000-result cap are disclosed.
- Lists are persisted in SQLite per primary machine, view, and PR state. Opening the page reads the saved snapshot; GitHub refreshes in the background when it is over 60 seconds old. Manual Refresh bypasses that window. Realtime notifications update open pages, and failed refreshes keep the last successful list visible. Loaded pages are refreshed together so closed PRs disappear without retaining stale pagination.
- **Review in thread** invokes Multirepo's `reviewUrl` RPC, creates a review thread in its umbrella workspace, links the PR with `requested-review`, and opens its existing review panel. Repositories do not need to be cloned to appear or to review their GitHub diff. Review prompts preserve the shared checkout and do not authorize posting to GitHub.

## Setup

Install PR Review from this collection. On BB’s primary machine, install `gh` and sign in with `gh auth login --hostname github.com`. Listing and opening PRs works without Multirepo or a project. This version supports github.com.

For **Review in thread**, also install Multirepo and select a valid Workspace project in its settings.

```sh
pnpm install --frozen-lockfile
pnpm --filter bb-plugin-multirepo build
pnpm --filter bb-plugin-pr-review build
bb plugin install path:. --plugin multirepo
bb plugin install path:. --plugin pr-review
```

Open **Pull requests** in bb's navigation. Multirepo also supports browsing a single repository’s PRs from its Repos view.

## Integration contract

Uses only public SDK calls. Listing resolves `primaryHostId` from `bb.sdk.system.config()` and runs GitHub CLI through the plugin host entry from that machine’s home directory. It does not call Multirepo or look up a project.

Only **Review in thread** calls `bb.sdk.plugins.callRpc` on `multirepo`:

- `reviewUrl({url})` → `{threadId, warning}` creates the review and links the PR. A link failure returns the created thread with a warning so the user can recover without creating a duplicate agent run.

The frontend stores the canonical URL in `sessionStorage` under `bb:multirepo:open-review:<threadId>` before `navigate.toThread(threadId)`, following Multirepo's browser integration protocol. Multirepo consumes it on thread-header mount.

Tests cover query semantics, pagination/limits, validation/auth failures, remote-host routing, Multirepo delegation, and the page-to-thread handoff. Run `pnpm exec vp test --project pr-review`.
