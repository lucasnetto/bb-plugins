# PR Review

A GitHub PR page inspired by [t3code's pull requests page](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/routes/_chat.pull-requests.tsx), using Multirepo's existing review threads and linked-PR panels.

- **Created by me** is the default: all open PRs authored by the current GitHub user, including drafts.
- Clicking a PR title opens it on GitHub.
- **Review requested** includes open requests to the user and their teams. GitHub's `review-requested:USERNAME` qualifier resolves team membership; no separate organization-membership scan is needed. Completed review requests disappear according to GitHub's search semantics.
- Results span accessible GitHub repositories, ordered by update time. Load more fetches 50 at a time. The text filter searches loaded results. GitHub's partial results and 1,000-result cap are disclosed.
- Lists are persisted in SQLite per primary machine, view, and PR state. Opening the page reads the saved snapshot; GitHub refreshes in the background when it is over 60 seconds old. Manual Refresh bypasses that window. Realtime notifications update open pages, and failed refreshes keep the last successful list visible. Loaded pages are refreshed together so closed PRs disappear without retaining stale pagination.
- **Review in thread** opens Multirepo’s draft review screen: BB’s composer beside the PR diff. Opening the screen starts no agent and creates no thread. Select code and collect comments; Send creates the conversation with your message, PR URL, and selected code context, links the PR manually, and opens its panel. No automatic review prompt is added.

## Setup

Install PR Review from this collection. On BB’s primary machine, install `gh` and sign in with `gh auth login --hostname github.com`. Listing and opening PRs works without Multirepo or a project. This version supports github.com.

For **Review in thread**, also install Multirepo. A Workspace project is not required.

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

**Review in thread** dispatches Multirepo’s cancelable `bb:multirepo:open-draft` browser event with `{url}`. Multirepo acknowledges it with `preventDefault()` and navigates to `/plugins/multirepo/review/<owner>/<repository>/<number>`. An unhandled request asks the user to enable Multirepo.

Multirepo owns draft loading, saved comments, and the composer. Its `startReview` RPC is called only on Send and returns `{threadId, warning}`. The existing `bb:multirepo:open-review:<threadId>` handoff opens the linked PR panel after thread navigation. A link failure returns the created thread with a warning so Send does not create a duplicate conversation.

Tests cover query semantics, pagination/limits, validation/auth failures, remote-host routing, and the draft handoff without thread creation. Run `pnpm exec vp test --project pr-review`.
