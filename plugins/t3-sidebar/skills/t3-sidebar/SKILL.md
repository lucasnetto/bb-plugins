---
name: t3-sidebar
description: Configure the T3 Sidebar plugin's active-thread machine grouping.
---

# T3 Sidebar

On Settings → Installed plugins → T3 Sidebar, **Group by machine**
(`groupByMachine`, boolean, default `false`) groups only the active thread
section by machine identity, across environments and projects. The project
scope picker still filters the list.

Pinned threads, Snoozed and Settled retain their existing layout and behavior.
Threads without machine information appear under **No machine**. Disabling
this setting restores the flat active-thread list.

CLI: `bb plugin config t3-sidebar set groupByMachine true` (or `false`).

Active and pinned cards support manual ordering: drag within the same section
(or machine group), or focus a card and press Alt+Up/Down. The insertion line
shows the drop position; Escape cancels. Order is stored in this browser,
separately for active and pinned, and survives project scope changes. New
threads appear first. Snoozed and Settled keep their time-based sorting.
Dragging out of the list continues to use BB's drag-to-split behavior. Touch
keeps scrolling rather than starting a reorder.
