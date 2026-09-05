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
- **Settled shelf.** Finished work you park (hover a card → *Settle*, or the
  context menu) collapses into slim rows under a collapsible `Settled (n)`
  header, sorted by when it wrapped up, paged 10 / +25. Hover a slim row to
  un-settle. A settled thread wakes on its own when it needs you again.
- **Auto-settle** — *Settings → Plugins → T3 Sidebar*: read, idle threads
  with no new attention for 1h / 6h / 1 day / 3 days / 1 week (or Never)
  settle without a click. Pinned threads never auto-settle.
- Right-click menu: open, open in split, pin, read/unread, settle, rename
  (also double-click / F2), archive, delete. Cmd/Ctrl-click opens in a split;
  rows can be dragged out to split. Host keyboard shortcuts keep working.

Pick it under **Settings → Appearance → Sidebar** if another list is pinned.

## Layout

- `server.ts` — the settled map (`threadId → settledAt`) in `bb.storage.kv`,
  two RPCs, one realtime signal, one setting.
- `lib/sidebar-logic.ts` — pure logic ported from t3code's
  `Sidebar.logic.ts`: status resolution, partition, sorting, shelf paging.
- `components/sidebar/` — `ThreadRow` (card + slim variants) and
  `T3ThreadList` (scope picker, sections, shelf).
- `components/ui/` — vendored shadcn source from the `@bb` registry.

## Develop

```
npm install
bb plugin install .
bb plugin dev        # rebuild + reload on save
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
