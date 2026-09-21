/** Unknown (new) threads lead; existing threads keep their saved relative order. */
export function applyThreadOrder<T extends { id: string }>(
  threads: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));

  return [...threads].sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
}

/** Move only the visible slots, preserving threads hidden by scope or machine grouping. */
export function moveThread(
  order: readonly string[],
  visible: readonly string[],
  source: string,
  target: string,
  after: boolean,
): string[] {
  if (source === target || !visible.includes(source) || !visible.includes(target))
    return [...order];
  const moved = visible.filter((id) => id !== source);
  moved.splice(moved.indexOf(target) + Number(after), 0, source);
  const visibleSet = new Set(visible);
  let index = 0;

  return order.map((id) => (visibleSet.has(id) ? moved[index++]! : id));
}
