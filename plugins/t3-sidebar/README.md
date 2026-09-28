# bb-plugin-t3-sidebar

A [t3code](https://github.com/pingdotgg/t3code)-style thread list for bb's
sidebar. Replaces bb's grouped list (`app.slots.experimental_threadList`) with
t3code's inbox model:

- **One flat stream across projects by default.** A project scope picker at
  the top narrows the list. Enable **Group by machine** on the T3 Sidebar
  plugin settings page to group only active threads under machine headings.
  Threads from different environments and projects on the same machine appear
  together. Pinned, Snoozed and Settled sections keep their existing layout.
  Threads without machine information appear under **No machine**.
- **Nested child threads.** Visible children appear indented beneath their parent,
  with tree connector lines, a child count beside the collapse chevron, and
  extra space between families. Use the chevron to collapse or expand descendants. Collapse state persists in
  this browser; opening a child reveals its ancestors. Nesting stays within the
  current section and machine group, and children whose parents are filtered out
  remain visible as roots. Hidden workers and side chats stay out of the sidebar.
  Dragging or Alt+Up/Down reorders siblings; moving a parent carries its children.
- **Cards, not rows.** Every live thread is a three-line card: project ·
  status/time, title, branch · PR · provider.
- **Pinned block** on top, closed by a thin divider.
- **Promote side chats.** In a side chat's composer, choose **Promote to sidebar**
  to turn it into a standalone thread and open it. Its conversation, model,
  provider session and workspace stay intact, and running work continues. The
  existing side-chat tab still points to the same conversation. Only live side
  chats show this action; workers and archived threads are excluded.
- **Manual order.** Drag active or pinned cards up/down to reorder within their
  section (and within a machine when grouped). A line shows the insertion point;
  hold near the scroll edge to scroll, or press Escape to cancel. Focus a card
  and use Alt+Up/Down as a keyboard alternative. New threads start at the top;
  activity never reorders cards. Ordering survives reloads in this browser and
  project filtering preserves hidden threads' positions. Snoozed and Settled
  remain time-ordered. Dragging out of the list still uses BB's split gesture.
  Touch retains normal scrolling; use the keyboard alternative to reorder.
- **Status vocabulary** (t3code hues): `Working` (sky), `Monitoring` (sky),
  `Input` (indigo), `Plan Ready` (violet), `Failed` (red), `Done` (emerald,
  unread only). Read, idle threads recede.
- **Input needs attention.** An unresolved question or approval takes priority
  over Working, Monitoring, and Done. Its indigo label and question icon stay
  at full prominence even after the thread is read or you navigate away.
  Answering clears Input through BB's live sidebar state. Pending input also
  brings snoozed threads back into view. BB exposes questions and approvals as
  one pending-interaction flag, so both use Input; idle threads and questions
  written only in assistant prose do not imply this state.
- **Settled shelf.** Settled means archived in BB. _Settle_ archives the thread,
  ends its active work through BB's lifecycle, and requests managed-worktree
  cleanup when no live threads use the environment. All visible archived
  threads appear in the shelf, including threads archived outside this plugin.
  Rows sort by BB's archive timestamp, paged 10 / +25. _Un-settle_ unarchives
  the thread. It does not recreate a removed worktree; conversations whose
  environments are gone remain read-only. There is no separate Archive action,
  settlement map, automatic wake-up, or inactivity-based settlement. Use Snooze
  for a temporary pause. Native archive/delete controls remain available from
  the open conversation.
  Legacy plugin-only settlement entries are ignored: unarchived threads return
  to the active list on upgrade, without a bulk archive or cleanup operation.
- **Snooze.** Hover a card or right-click → _Snooze_: 1 hour, 3 hours,
  this evening (18:00), tomorrow (09:00), or next Monday (09:00), in your
  local timezone. The evening option disappears when it is less than an hour away.
  Threads move to a collapsible **Snoozed** shelf, ordered by wake time;
  cards use the active-thread layout with an added wake-time line.
  _Wake now_ returns them immediately. Snoozing preserves pinned state.
  Running work continues, including completion while snoozed. A new turn,
  input request, or failure wakes the thread early. Threads awaiting input
  or queued work cannot be snoozed. Settling a snoozed thread parks it instead.
  Wake times persist across reloads and restarts, sync across clients, and
  are checked when the sidebar opens or regains focus. Expired reminders
  return to the active list.
- Right-click menu: open, open in split, pin, read/unread, settle, rename
  (also double-click / F2), delete. Cmd/Ctrl-click opens in a split;
  rows can be dragged out to split. Host keyboard shortcuts keep working.

Pick it under **Settings → Appearance → Sidebar** if another list is pinned.

Project controls follow T3 Code: search in the project picker, use the **New
project** folder button beside it to add a folder, or open a project's gear for
its settings page. The page has name, default model/reasoning, workspace, automatic
pull, and a separate Danger section for removal. Removal explicitly confirms
deletion of the project and all its threads. The personal project cannot be removed.

Names update BB directly. Model and workspace preferences apply when starting a
thread from the scoped sidebar's **+** button or the settings page's **New thread**
button. These use BB's native composer; subsequent user selections remain authoritative.
BB's global New thread button and CLI retain their existing defaults. **Reset**
on the model restores BB's remembered execution choice; **Default** workspace uses
the native composer's preference.

Automatic pull runs every five minutes on connected machines while this plugin is
enabled. For a folder containing multiple repositories, such as `180seg`, it
discovers checkouts recursively through grouping folders and checks each one
independently. Discovery stops at each checkout (including `.git` files used by
worktrees), so submodules are not pulled separately. It skips directory symlinks,
hidden folders such as `.worktrees`, bare repositories, and `node_modules`,
`vendor`, `target`, `dist`, and `build` folders. A project pointing directly at a
checkout continues to update that checkout.

It only fast-forwards a clean checkout of the remote's default branch, skipping
local commits, untracked changes, and other branches. It never switches branches
or resets the checkout. Discovery and pull failures are logged with their paths;
other repositories continue to be checked.

## Layout

- `src/server/lib/settled.ts` — BB archive/unarchive RPCs, archived-history listing,
  and lifecycle refresh signals.
- `src/server/lib/snooze.ts` — persisted snooze state, validated RPCs, and early-wake events.
- `src/ui/lib/sidebar-logic.ts` — pure logic ported from t3code's
  `Sidebar.logic.ts`: status resolution, partition, sorting, shelf paging.
- `src/ui/hooks/useThreadReorder.ts` — whole-card pointer sorting inspired by
  t3code’s `Sidebar.pointer.ts`, with BB split handoff and keyboard ordering.
- `src/ui/components/sidebar/` — `ThreadRow` (card + slim variants) and
  `T3ThreadList` (scope picker, sections, shelf).
- `src/ui/components/ui/` — vendored shadcn source from the `@bb` registry.

## Develop

```
vp install
bb plugin install .
bb plugin dev        # rebuild + reload on save
```

Run checks from the repository root:

```
bb plugin build plugins/t3-sidebar
vp run --filter bb-plugin-t3-sidebar typecheck
vp test --project t3-sidebar
```

## Multiple linked PRs

When PR Review is installed, each thread card shows its explicitly linked PRs
with repository names and numbers. Badges open the owning thread and its PR review tab. Modified clicks
open GitHub. The GitHub plugin is not required.
Tooltips show the last fetched status. Threads without manual links keep BB's branch-detected badge.

The sidebar batches link reads through PR Review's public local-auth HTTP
endpoint, reconciles on focus/reconnect, and listens to its documented
`bb:pr-review:links-changed` invalidation event. No BB DOM selectors or internal
state are used.

PR navigation uses the one-use sessionStorage request and browser event
`bb:pr-review:open-review` documented in PR Review’s README.

### Effect backend workflows

Project settings, settled-thread updates and auto-pull use Effect v4. Settings
updates serialize per project using scoped, reference-counted semaphores;
settlement delegates directly to BB’s native archive/unarchive lifecycle. Managed runtimes are
owned by plugin disposal. BB retains ownership of the five-minute auto-pull
schedule; overlapping passes are skipped and cancellation reaches host Git
commands. The clean/default-branch checks before and after fetch remain in
place, and writes are never retried. Project CRUD, directory listing and thread creation also return Effects, with
Promise conversion at BB entry points.

With the Rename Thread plugin installed and enabled, the thread context menu also offers **Regenerate title**. Generation runs separately from the thread; the menu displays progress and reports the result in a toast.

While a title is being regenerated, its thread row shows a spinner and **Renaming…**, including after the context menu closes.
