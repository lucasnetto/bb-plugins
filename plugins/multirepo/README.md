# Multirepo for bb

Browse a folder of independent Git repositories without changing bb core.

## Use

Choose the umbrella project in **Settings → Multirepo → Workspace project**.
The plugin uses that project's default local source and its owning machine.

- **Repos** in the sidebar: search repositories, select one, then browse Changes or Files.
- **Repos** in a thread's panel Actions: the same configured umbrella workspace beside the conversation.
- **Pull requests** in the sidebar is provided by the PR Review plugin, with Created by me and Review requested views across GitHub.
- Select a changed file to read its staged or working-tree diff. Untracked files open as source. **Open file** uses bb's native file preview and editor actions.
- **Refresh** reloads repository state and the current view. This version uses explicit refresh, not background filesystem watching.

Git must be available on the workspace machine. Linked PR reviews also require authenticated `gh`. PR browsing is provided by the separate PR Review plugin.

## Agent/CLI access

```sh
bb multirepo status
bb multirepo changes canguruga
bb multirepo files canguruga
bb multirepo diff canguruga path/to/file
bb multirepo diff canguruga path/to/file --staged
```

Output is JSON. Commands are exposed through bb's plugin command inventory.

## Scope

Discovery includes nested container folders and `.git` files used by worktrees. It stops at repository roots and skips hidden directories, symlinks, and conventional dependency/build directories (`node_modules`, `vendor`, `target`, `dist`, `build`). Git-ignored files are excluded from file browsing. Files resolving outside their repository are not previewed.

The plugin provides its own Repos panel. It does not alter bb's native Git environment model. Git writes and coordinated worktree creation are not implemented in this version. Binary and oversized files show a notice; preview output is bounded by bb's host RPC transport limit. GitHub can omit individual file patches and limits the PR-files endpoint to 3,000 files.

## Development

```sh
vp install
vp run typecheck
vp test
bb plugin build
bb plugin install . --yes
```

Source layout: `src/server/git.ts` reads Git on the owning host; `src/server/host.ts` exposes typed host RPC; `src/server/server.ts` resolves the project and launches review threads; `src/ui/app.tsx` registers the panels and reuses bb source/diff viewers.

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
PR-based settlement, automatic linking, or posting to GitHub. The repository Pull requests tab has a separate Start review action; linked PR reviews stay in their owning thread.

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

### Guided review

In a linked PR's code panel, **Guide → Generate guide** opens BB's native
provider/model picker, including reasoning and service tier. Generation runs in
a hidden worker and saves the walkthrough directly into the panel, with status,
errors, and cancellation. It leaves the chat draft untouched.

Configure the default in **Multirepo settings → Guided review model**. An optional
project override takes precedence over the plugin default, then the current
thread's model is the fallback. The launch picker changes only that run.
Jobs survive reloads, reject outdated PR revisions, and archive/stop their workers
when finished or cancelled.

Chapters explain the core change, its consequences, and supporting changes.
Chapters appear as a scrolling page of cards, with explanations and file chips
on the left and the same selectable Pierre diffs on the right. On narrow panels,
the columns stack. Reviewed checkboxes collapse chapters and persist per thread
and PR; collapsed chapters can be reopened without losing progress. Files outside the main chapters remain visible under Everything else.
Guides are pinned to both base and head commits. Earlier-revision explanations
remain readable, but code and progress changes require regeneration; invalid paths, duplicates, and omitted files reject the save.

Agent tools: `get_review_guide_context` and `save_review_guide`. Existing agent
sessions can use `bb multirepo guide-context <url>` and
`bb multirepo guide-save <url> <base> <head> '<JSON>'`. The context handoff is
bounded; oversized diffs return an explicit instruction to inspect the PR with
`gh` instead. Nothing is sent to GitHub. Unlinking a PR or deleting its thread
removes its guide.

The organizer prompt and guide format are adapted from
[Plannotator](https://github.com/backnotprop/plannotator) commit
`4afdd4cd89e863c997900c1860355dc10d9294b6`.
Its MIT notice is retained in `src/PLANNOTATOR-LICENSE`. Chapter-card layout is also adapted from Plannotator;
BB storage and diff/composer integration are implemented locally.

### Effect backend

Git and GitHub workflows compose in Effect v4 (`4.0.0-rc.112`, pinned in the
workspace catalog). `src/server/host-effects.ts` owns command execution, filesystem error
mapping and decoding. `src/server/git.ts` and `src/server/links-host.ts` compose these operations as Effects.
RPC, CLI, HTTP, mention and event entry points run the effects using the
plugin-owned runtime; internal operations never call Promise handlers.
Discovery inspects up to four repositories concurrently, with three Git reads
per repository. PR detail and revision reads use structured concurrency so a
failed read interrupts its siblings. Existing Zod RPC contracts remain intact.

Host requests pass BB's AbortSignal into the Effect runtime and through to
subprocesses. Already-cancelled requests do not launch commands. Server
workflows use managed runtimes disposed by BB on reload, including host-call
cancellation. Plain SDK promises without cancellation support may finish their
current call, but the interrupted workflow does not advance to subsequent steps.
Expected repository failures remain error rows; interruption is never recovered
as a successful result. Commands are not automatically retried.

Tests cover temporary Git repositories, injectable command failures, revision
reads, bounded discovery, cancellation, and serving requests after reload.

### T3 source attribution

`src/ui/review/StyledDiffCodeView.tsx`, the diff theme, file tree, and tree helpers are
adapted from T3 Code commit `f3bbdb606f98d8cc2e6c2fd8074b5a0c12cc3828`.
The original copyright and MIT terms are retained in `src/ui/review/T3-LICENSE`.
`src/ui/review/PrReview.tsx` replaces T3's environment/state/composer dependencies with
BB RPC and composer APIs. It shares the host's Pierre diff runtime; the tree
uses the pinned `@pierre/trees` dependency.

The sidebar requests a review through the documented browser event
`bb:multirepo:open-review` and a one-use sessionStorage URL at
`bb:multirepo:open-review:<threadId>`. It opens the owning thread with BB's SDK;
the thread header consumes the validated request after mounting and opens its
own panel. No BB internals or DOM selectors are used. Modified clicks retain
the external GitHub URL.

Code comments use a native BB mention chip beside the visible comment, instead of pasting the diff into the composer. The chip resolves its saved PR/file/line/code snapshot at send time and survives reloads. Removing the chip removes that context from the draft. Comment snapshots are deleted with their owning thread. Command-Enter in the comment field stages the comment and chip; it does not send the chat.

## Browser integration

Multirepo owns the sidebar-to-review navigation protocol. Its consumer is
`src/ui/lib/review-navigation.ts`; T3 Sidebar's producer is
`plugins/t3-sidebar/src/ui/lib/multirepo-navigation.ts`. Each adapter stays in
its own plugin so the plugins remain independently distributable.

To open a linked review, store the GitHub PR URL in session storage under
`bb:multirepo:open-review:<threadId>`, navigate to that thread, then dispatch
`bb:multirepo:open-review` on `window`. The thread header consumes and removes
its own pending URL once, validates it, and opens the Linked PRs panel.
Storage handles a header that mounts after navigation; the event handles a
header already mounted in the same thread. Other threads' requests remain
pending. Both sides must preserve these names and ordering when this protocol
changes. The listener is removed when the header unmounts.

## Guide generation internals

`server/guide-models.ts` resolves model preferences, `server/guide-job-store.ts`
owns job persistence, and `server/guide-generation.ts` orchestrates workers,
completion, cancellation, and restart recovery. Job identity checks read the
current stored job again after asynchronous work, so an old result cannot
replace a cancelled or newer generation. The status-specific job schema lives
in `shared/guide-generation.ts`; an append-only storage migration removes
legacy placeholder fields before jobs are decoded. Failed and cancelled jobs
retain any known revisions in their nullable `revision` field.
