import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export interface ThreadTreeRow {
  thread: PluginSidebarThread;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
  childCount: number;
  isLastChild: boolean;
  ancestorContinues: boolean[];
  startsFamily: boolean;
}

/** Build only within a visible section: missing parents remain accessible roots. */
export function threadTree(
  threads: PluginSidebarThread[],
  collapsed: readonly string[],
  activeId?: string | null,
): ThreadTreeRow[] {
  const ids = new Set(threads.map((thread) => thread.id));
  const parents = new Map<string, string | null>();
  for (const thread of threads) {
    const parent = thread.parentThreadId;
    parents.set(thread.id, parent && parent !== thread.id && ids.has(parent) ? parent : null);
  }
  // Break malformed cycles without losing any conversations.
  for (const thread of threads) {
    const seen = new Set<string>();
    let id: string | null = thread.id;
    while (id !== null) {
      if (seen.has(id)) {
        parents.set(id, null);
        break;
      }
      seen.add(id);
      id = parents.get(id) ?? null;
    }
  }
  const children = new Map<string | null, PluginSidebarThread[]>();
  for (const thread of threads) {
    const parent = parents.get(thread.id) ?? null;
    children.set(parent, [...(children.get(parent) ?? []), thread]);
  }
  const reveal = new Set<string>();
  let ancestor = activeId ? parents.get(activeId) : null;
  while (ancestor) {
    reveal.add(ancestor);
    ancestor = parents.get(ancestor);
  }
  const closed = new Set(collapsed);
  const rows: ThreadTreeRow[] = [];
  const visit = (parentId: string | null, depth: number, ancestorContinues: boolean[]) => {
    const siblings = children.get(parentId) ?? [];
    for (const [index, thread] of siblings.entries()) {
      const isLastChild = index === siblings.length - 1;
      const hasChildren = children.has(thread.id);
      const expanded = !closed.has(thread.id) || reveal.has(thread.id);
      rows.push({
        thread,
        depth,
        parentId,
        hasChildren,
        expanded,
        childCount: children.get(thread.id)?.length ?? 0,
        isLastChild,
        ancestorContinues,
        startsFamily: depth === 0 && rows.length > 0,
      });
      if (expanded)
        visit(thread.id, depth + 1, depth === 0 ? [] : [...ancestorContinues, !isLastChild]);
    }
  };
  visit(null, 0, []);
  return rows;
}
