# bb-plugin-t3-sidebar

A [t3code](https://github.com/pingdotgg/t3code)-style thread list for bb's
sidebar. Replaces bb's grouped list (`app.slots.experimental_threadList`) with
t3code's inbox model:

- **One flat stream across projects.** No per-project groups; a project
  scope picker at the top narrows the list when you want it.
- **Cards, not rows.** Every live thread is a three-line card: project ·
  status/time, title, branch · PR · provider.
- **Pinned block** on top, closed by a thin divider.
- **Static order.** Active cards sort by creation, newest first. Activity
  never reorders the list; status lives in each card's label.
- **Status vocabulary** (t3code hues): `Working` (sky), `Monitoring` (sky),
  `Input` (indigo), `Plan Ready` (violet), `Failed` (red), `Done` (emerald,
  unread only). Read, idle threads recede.
- **Settled shelf.** Finished work you park (hover a card → _Settle_, or the
  context menu) collapses into slim rows under a collapsible `Settled (n)`
  header, sorted by when it wrapped up, paged 10 / +25. Hover a slim row to
  un-settle. A settled thread wakes on its own when it needs you again.
- **Snooze.** Hover a card or right-click → _Snooze_: 1 hour, 3 hours,
  this evening (18:00), tomorrow (09:00), or next Monday (09:00), in your
  local timezone. The evening option disappears when it is less than an hour away.
  Threads move to a collapsible **Snoozed** shelf, ordered by wake time;
  _Wake now_ returns them immediately. Snoozing preserves pinned state.
  Running work continues, including completion while snoozed. A new turn,
  input request, or failure wakes the thread early. Threads awaiting input
  or queued work cannot be snoozed. Settling a snoozed thread parks it instead.
  Wake times persist across reloads and restarts, sync across clients, and
  are checked when the sidebar opens or regains focus. Expired reminders
  stay in the inbox until read before auto-settle can apply again.
- **Auto-settle** — _Settings → Plugins → T3 Sidebar_: read, idle threads
  with no new attention for 1h / 6h / 1 day / 3 days / 1 week (or Never)
  settle without a click. Pinned threads never auto-settle.
- Right-click menu: open, open in split, pin, read/unread, settle, rename
  (also double-click / F2), archive, delete. Cmd/Ctrl-click opens in a split;
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
enabled. It only fast-forwards a clean checkout of the remote's default branch,
skipping local commits, untracked changes, other branches, and non-Git folders.
It never switches branches or resets the checkout.

## Layout

- `src/server/server.ts` — the settled map (`threadId → settledAt`) in `bb.storage.kv`,
  its RPCs, realtime signal, and auto-settle setting.
- `src/server/lib/snooze.ts` — persisted snooze state, validated RPCs, and early-wake events.
- `src/ui/lib/sidebar-logic.ts` — pure logic ported from t3code's
  `Sidebar.logic.ts`: status resolution, partition, sorting, shelf paging.
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

When Multirepo is installed, each thread card shows its explicitly linked PRs
with repository names and numbers. Badges open the owning thread and its Multirepo PR review tab. Modified clicks
open GitHub. The GitHub plugin is not required.
Tooltips show the last fetched status. Threads without manual links keep BB's branch-detected badge.

The sidebar batches link reads through Multirepo's public local-auth HTTP
endpoint, reconciles on focus/reconnect, and listens to its documented
`bb:multirepo:links-changed` invalidation event. No BB DOM selectors or internal
state are used. Existing inactivity settlement is unchanged.

PR navigation uses the one-use sessionStorage request and browser event
`bb:multirepo:open-review` documented in Multirepo’s README.

### Effect backend workflows

Project settings, settled-thread updates and auto-pull use Effect v4. Settings
updates serialize per project using scoped, reference-counted semaphores;
settled updates serialize their read/write operation. Managed runtimes are
owned by plugin disposal. BB retains ownership of the five-minute auto-pull
schedule; overlapping passes are skipped and cancellation reaches host Git
commands. The clean/default-branch checks before and after fetch remain in
place, and writes are never retried. Project CRUD, directory listing and thread creation also return Effects, with
Promise conversion at BB entry points.
