export function snoozePresets(now: Date) {
  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7));
  nextWeek.setHours(9, 0, 0, 0);
  return [
    { id: "hour", label: "For 1 hour", until: now.getTime() + 3_600_000 },
    { id: "three-hours", label: "For 3 hours", until: now.getTime() + 10_800_000 },
    ...(evening.getTime() - now.getTime() > 3_600_000
      ? [{ id: "evening", label: "This evening", until: evening.getTime() }]
      : []),
    { id: "tomorrow", label: "Tomorrow", until: tomorrow.getTime() },
    { id: "next-week", label: "Next week", until: nextWeek.getTime() },
  ];
}

export function snoozeWakeLabel(until: number, nowMs: number) {
  const date = new Date(until);
  const today = new Date(nowMs);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return time;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}
