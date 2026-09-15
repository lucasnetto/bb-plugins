# PR Review for bb

Find pull requests, review code with an agent, and track the linked conversation through completion.

## Find and review a PR

**Pull Requests** shows a flat **Authored** and **Review requested** inbox with avatars, checks, change counts, labels, and native stack positions. Search the loaded results (including `label:bug`, `author:login`, `repo:owner/name`, quoted terms, and exclusions), sort them, or filter by state, involvement, draft status, repository, checks, and review decision. Open PRs appear by default; closed and merged PRs are available in Filters. More results load in pages of 50, with GitHub's partial results and 1,000-result limit disclosed.

Select a row to open a resizable detail pane with multiple PR tabs. **Summary** shows the description, reviewers, labels, checks, conversation, and native GitHub stack. **Timeline** shows paginated activity and Markdown comments. Descriptions, comments, and editor previews support GitHub-flavored Markdown and sanitized HTML, including bot badges and collapsible details; hidden HTML comments stay hidden. **Code** keeps the existing diff and review tools. Switching tabs or hiding the pane preserves unfinished reviews. Modified clicks keep the external GitHub link.

The detail header supports merge, auto-merge, update by merge or rebase, ready/draft, close/reopen, title/description editing, labels, reviewer requests, and checkout in a matching thread environment. Standalone PRs can copy the checkout command.

Merge confirmation lists the exact affected stack layers. Native GitHub stacks merge through the asynchronous stack API, including every unmerged layer below the selected PR, and continue polling after a page reload. Stack rebase starts at the top PR and updates all open layers bottom to top. Branch heads, the target branch, and stack membership are rechecked before writing. Ordinary merges use GitHub CLI's matching-head guard and respect repository merge methods, rules, and queues. A partially completed stack rebase reports the layer where it stopped.

Lists are saved in SQLite per primary machine, view, and PR state. Opening the page displays the saved list, then refreshes it when older than 60 seconds. Manual Refresh bypasses that window. Failed refreshes preserve the last successful list.

Use **Open a pull request by URL** in Pull Requests to view any GitHub PR in the integrated detail pane.

## PRs linked to a conversation

Use the thread header, panel launcher, or command palette to open **Linked PRs**. A thread can have multiple PRs from different repositories. Paste a URL to link one, open its review, or unlink it independently. Canonical GitHub URL identity prevents duplicate links.

The **Code** tab provides a file tree, split/unified diffs, wrapping, file collapse controls, and expandable unchanged lines. Complete file contents load from pinned GitHub revisions: the head commit and the comparison's merge base. Missing or binary patches have an explicit GitHub fallback. Background refresh preserves the selection and unfinished comment; a new revision clears the selection and reloads cached contents.

Select lines to open a comment composer directly below the selection in Code or Guide view. It appears when the selection gesture finishes and preserves typed text when moved or closed. Choose **Add to chat**, **Ask**, **Explain**, or **Fix** to stage text and a code-context mention chip in the existing draft; these actions never send it. The saved snapshot includes the PR, file, revisions, selected lines, and code. Removing the chip removes that context from the draft. Command-Enter stages the comment.

Linked reviews use the thread environment's machine and its `gh` authentication. Standalone PR details and PR lists use BB's primary machine. No workspace setting or local repository is required. If the thread's current Git checkout matches the PR, its root is included in code context; parent folders are never scanned.

## Guided reviews

In the linked PR’s **Code** tab, choose **Guide → Generate guide**, then select the provider/model, reasoning, and service tier. A hidden worker creates a chaptered walkthrough directly in the panel without modifying the chat draft. Generation supports cancellation, errors, restart recovery, and worker cleanup.

Configure the default in **PR Review settings → Guided review model**. Project overrides take precedence over the plugin default, with the thread model as fallback. The launch picker changes only that run.

Chapters pair explanations with selectable diffs. Reviewed checkboxes collapse chapters and persist per thread/PR. Every changed file must appear exactly once; other files appear under Everything else. Guides are pinned to both revisions. Outdated explanations remain readable, but regeneration is required before reviewing newer code or changing progress.

## Automatic settling

**Automatically settle completed PR threads** is enabled by default and can be disabled in PR Review settings:

```sh
bb plugin config pr-review set autoSettle false
```

PR overview, stack, and linked-detail refreshes trigger a settlement check as soon as all linked PRs are known merged or closed. The check freshly verifies every linked PR before archiving the thread. A five-minute server poll remains as a fallback when no panel is open or an earlier check was deferred; it is not a waiting period after detecting completion. A visible, idle thread with at least one PR settles only when all linked PRs are confirmed merged or closed. Failed lookups, queued messages, active agents, and busy descendants defer settling.

Manually un-settling a thread keeps it open across reloads. Another automatic settlement requires a PR URL never included in any previous settlement, with all current links closed or merged. Relinking or reopening/reclosing previously settled PRs does not cause another settlement.

## Agent tools and CLI

Agents have `link_pull_request`, `unlink_pull_request`, `list_linked_pull_requests`, `get_review_guide_context`, and `save_review_guide`.

Link a PR when creating it, working on or reviewing it at the user's request, or explicitly asked to link it. Background references stay unlinked. Existing provider sessions can use the CLI:

```sh
bb pr-review links
bb pr-review link https://github.com/owner/repo/pull/123 requested-review
bb pr-review unlink https://github.com/owner/repo/pull/123
bb pr-review guide-context https://github.com/owner/repo/pull/123
bb pr-review guide-save <url> <base> <head> '<JSON>'
```

Commands use the current thread and return bounded output. Guide context includes the walkthrough instructions and schema; oversized diffs direct the agent to inspect the PR using `gh`. These CLI commands do not post comments or reviews to GitHub; the explicit actions in the UI do.

## Setup and migration from Multirepo

Requires authenticated GitHub CLI on the relevant machine. This version supports github.com URLs.

PR Review now owns the entire PR workflow. Repository browsing, its workspace setting, and all `bb multirepo` commands have been removed. Update T3 Sidebar with PR Review so its PR badges use the new integration.

For an existing installation, disable Multirepo **before** loading the consolidated PR Review plugin. This stops the old schedules and workers' completion handlers from writing after the migration snapshot. Then reload/install PR Review and T3 Sidebar. After verifying the import, remove the retired Multirepo installation.

On first load, PR Review copies links, guides and review progress, guide jobs, settlement history, and default/project guide models. The original PR list cache remains intact. Existing destination rows and settings win. The import is transactional for review rows and runs once, so later unlinking cannot resurrect old data. Old plugin data is read without modification and retained for recovery.

**Unsent Multirepo drafts and their code chips are not migrated.** Recreate any needed draft comments in PR Review. Old plugin routes and commands have no compatibility aliases.

Opening a PR never creates a thread association. Use **Link PR** beside **Check out** to associate it with the current thread; the button then becomes **Unlink PR**. Unlinking leaves the review panel open. Agent comments and guided reviews require a linked PR. The linked-PR picker and agent linking tool also support explicit linking.

## Sidebar integration

T3 Sidebar reads the locally authenticated endpoint:

`POST /api/v1/plugins/pr-review/http/linked-prs` with `{ threadIds }`.

The thread header relays realtime changes as `bb:pr-review:links-changed`. The sidebar also refreshes on focus/reconnect. When PR Review is unavailable it falls back to branch-detected PR badges.

To open a linked review, store the GitHub PR URL in session storage under `bb:pr-review:open-review:<threadId>`, navigate to that thread, then dispatch `bb:pr-review:open-review` on `window`. The owning thread header consumes and removes the validated URL once. Storage handles a header mounting after navigation; the event handles an already-mounted header. Modified clicks retain the external GitHub URL.

PR Review owns the consumer in `src/ui/lib/review-navigation.ts`; T3 Sidebar owns its independent producer in `src/ui/lib/pr-review-navigation.ts`. Neither uses BB internals or DOM selectors for the handoff.

## Development and attribution

```sh
vp install
vp check plugins/pr-review plugins/t3-sidebar
vp test --project pr-review --maxWorkers=4
bb plugin build plugins/pr-review
bb plugin build plugins/t3-sidebar
```

GitHub review workflows use the workspace-pinned Effect v4 runtime, with cancellation passed through to host calls and subprocesses. Runtime disposal interrupts in-flight work. Commands are not automatically retried.

The inbox, detail layout, and remote stack workflow follow T3 Code commit `0f602b3372b300ae94084bd3fe7dbaadaa58ba3a`, with BB navigation, host styling, and the existing review features preserved.

The styled Pierre diff viewer and tree are adapted from T3 Code commit `f3bbdb606f98d8cc2e6c2fd8074b5a0c12cc3828`; its MIT notice is retained in `src/ui/review/T3-LICENSE`. Guide organization and chapter cards are adapted from Plannotator commit `4afdd4cd89e863c997900c1860355dc10d9294b6`; its MIT notice is retained in `src/PLANNOTATOR-LICENSE`.

## GitHub reviews

Select lines and choose **Add to review** to save a private pending comment on
GitHub, or **Add to chat** to send the selected code to the agent composer.
The GitHub review section shows pending and published comments, supports editing
and removing pending comments, and submits or discards the shared pending review.
It includes comments started on GitHub under the same authenticated `gh` account.

Line-comment drafts live on GitHub. The overall summary is temporary editor text
sent on submission: GitHub's API cannot add a summary to an existing empty-body
pending review. Review state refreshes in the background every 30 seconds and on
window focus; PR details refresh every minute. Existing content stays visible,
and refreshes preserve unsaved editor text. New commits and edits from another
client are checked before writing. A failed write is never retried automatically.

The plugin uses the thread's host and its existing GitHub CLI authentication;
standalone reviews use the primary host. It adds no draft database or credentials.
