# Multirepo for bb

Browse a folder of independent Git repositories without changing bb core.

## Use

Choose the umbrella project in **Settings → Multirepo → Workspace project**.
The plugin uses that project's default local source and its owning machine.

- **Repos** in the sidebar: search repositories, select one, then browse Changes, Files, or Pull requests.
- **Repos** in a thread's panel Actions: the same configured umbrella workspace beside the conversation.
- **PR inbox** in the sidebar: open PRs across discovered GitHub repositories, with repository/title/number filtering.
- Select a changed file to read its staged or working-tree diff. Untracked files open as source. **Open file** uses bb's native file preview and editor actions.
- Select a PR to inspect its files and click **Start review** to create a review thread in the umbrella checkout. The prompt identifies the exact nested repo and PR, and tells the agent to preserve the shared checkout and report findings without posting to GitHub.
- **Refresh** reloads repository state and the current view. This version uses explicit refresh, not background filesystem watching.

Git and authenticated `gh` must be available on the workspace's machine. PR discovery supports `github.com` origin remotes over HTTPS or SSH. Failures from individual PR repositories are shown without discarding successful results.

## Agent/CLI access

```sh
bb multirepo status
bb multirepo changes canguruga
bb multirepo files canguruga
bb multirepo diff canguruga path/to/file
bb multirepo diff canguruga path/to/file --staged
bb multirepo prs tubarao
```

Output is JSON. Commands are exposed through bb's plugin command inventory.

## Scope

Discovery includes nested container folders and `.git` files used by worktrees. It stops at repository roots and skips hidden directories, symlinks, and conventional dependency/build directories (`node_modules`, `vendor`, `target`, `dist`, `build`). Git-ignored files are excluded from file browsing. Files resolving outside their repository are not previewed.

The plugin provides its own Repos panel. It does not alter bb's native Git environment model. Git writes and coordinated worktree creation are not implemented in this version. Binary and oversized files show a notice; preview output is bounded by bb's host RPC transport limit. GitHub can omit individual file patches and limits the PR-files endpoint to 3,000 files.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
bb plugin build
bb plugin install . --yes
```

Source layout: `git.ts` reads Git/GitHub on the owning host; `host.ts` exposes typed host RPC; `server.ts` resolves the project and launches review threads; `app.tsx` registers the panels and reuses bb source/diff viewers.

## Linked PRs per thread

Agents have `link_pull_request`, `unlink_pull_request`, and
`list_linked_pull_requests` tools. Link a PR after creating it, when asked to
review or work on it, or when explicitly asked to link it. Background references
stay unlinked. Tools use the current thread automatically; no message scanning
or separate evaluator runs. New tools appear when BB next starts/resumes the
provider session.

Existing sessions can use:

```sh
bb multirepo link https://github.com/owner/repo/pull/123 requested-review
bb multirepo links
bb multirepo unlink https://github.com/owner/repo/pull/123
```

The thread header, panel launcher, and command palette open **Linked PRs**.
Paste a URL to link it manually, open **Review**, or unlink one without affecting
the others. Each PR opens in its own tab beside the current conversation. The
code view ports T3 Code's styled, virtualized Pierre viewer and file tree, with
unified/split diffs, wrapping, folder navigation, and file collapse controls.
Select line numbers or drag a range, write a comment, and choose **Add to chat**.
You can also use Ask, Explain, or Fix. These append
PR, file, old/new line, patch, and checkout context to the current draft. These
actions never send a message or start another thread. Refresh clears stale
line selections while preserving any unfinished comment; reselect lines before adding it. Missing/binary patches have an explicit GitHub fallback.

The initial port covers code review. Summary, activity, host review comments,
are not included. Click an **unmodified lines** separator to expand that block. **Collapse context**
returns to the compact diff. Full file contents load for visible diff headers,
using the PR's pinned head commit and the comparison's merge base. BB's bundled
Pierre version needs complete file metadata before it enables expansion. Loads
are deduplicated for this PR revision; Refresh resets that cache and selections.
Expanded unchanged lines support the same comments and agent actions. Load
errors keep the patch visible and offer retry via Refresh. Binary or omitted
patches retain the GitHub fallback.

Links persist in the plugin database and survive reloads. Canonical GitHub URL
identity prevents duplicate links; individual SQL inserts/deletes keep concurrent
links from overwriting each other. The thread's actual environment selects the
host and CLI working directory, independently of the Multirepo workspace setting.
The host uses its `gh` authentication. A local repository is optional; an ambiguous
checkout match is treated as unavailable. This version supports github.com URLs.

PR status is fetched when linking or refreshing a review. The list and
sidebar show the last fetched state. There is no background GitHub polling,
PR-based settlement, automatic linking, or posting to GitHub. The original
workspace PR inbox still has its separate Start review action; linked PR reviews stay in their owning thread.

T3 Sidebar reads the public, locally authenticated
`POST /api/v1/plugins/multirepo/http/linked-prs` endpoint with `{ threadIds }`.
The Multirepo thread-header component relays plugin realtime invalidations as
`bb:multirepo:links-changed` browser events. Sidebar badges and Linked PRs review buttons open the ported code review tab. Focus/reconnect also refresh sidebar
links. Disabling Multirepo restores branch-detected badges on the next refresh.

Validation: backend tests cover concurrent links, canonical duplicates,
per-thread unlink, reload persistence, failed lookups, and remote-host routing.
Frontend tests cover PR tab selection and independent unlinking. Selection tests
cover old/new sides, reverse dragging, stale lines, and repository-specific
handoffs. Live BB verification covered split/unified rendering, wrapping, tree
navigation, collapse/expand, selected-line Explain/Fix preserving the draft, and
sidebar navigation back into the original thread.

### T3 source attribution

`review/StyledDiffCodeView.tsx`, the diff theme, file tree, and tree helpers are
adapted from T3 Code commit `f3bbdb606f98d8cc2e6c2fd8074b5a0c12cc3828`.
The original copyright and MIT terms are retained in `review/T3-LICENSE`.
`review/PrReview.tsx` replaces T3's environment/state/composer dependencies with
BB RPC and composer APIs. It shares the host's Pierre diff runtime; the tree
uses the pinned `@pierre/trees` dependency.

The sidebar requests a review through the documented browser event
`bb:multirepo:open-review` and a one-use sessionStorage URL at
`bb:multirepo:open-review:<threadId>`. It opens the owning thread with BB's SDK;
the thread header consumes the validated request after mounting and opens its
own panel. No BB internals or DOM selectors are used. Modified clicks retain
the external GitHub URL.

Code comments use a native BB mention chip beside the visible comment, instead of pasting the diff into the composer. The chip resolves its saved PR/file/line/code snapshot at send time and survives reloads. Removing the chip removes that context from the draft. Comment snapshots are deleted with their owning thread. Command-Enter in the comment field stages the comment and chip; it does not send the chat.
