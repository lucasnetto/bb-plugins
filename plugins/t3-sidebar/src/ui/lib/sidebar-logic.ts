// Pure sidebar logic, ported from t3code's Sidebar.logic.ts and adapted to
// bb's PluginSidebarThread payload. Nothing here touches React or the DOM so
// it can be unit-tested in isolation.
import type { SnoozedMap } from "../../shared/snooze-contract";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export const SETTLED_TAIL_INITIAL_COUNT = 10;
export const SETTLED_TAIL_PAGE_COUNT = 25;

// ── Status model ─────────────────────────────────────────────────────
// t3code's five visual states, three colors: color is reserved for "act now"
// (input), "in motion" (working), and "broken" (failed). Ready is the
// unlabeled resting state. Unread completion is tracked separately (Done).
export type SidebarThreadStatus = "input" | "working" | "monitoring" | "plan" | "failed" | "ready";

type StatusInput = Pick<
  PluginSidebarThread,
  "indicator" | "hasPendingInteraction" | "activity" | "isUnread"
>;

export function resolveThreadStatus(thread: StatusInput): SidebarThreadStatus {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") {
    return "input";
  }
  switch (thread.indicator) {
    case "runtime":
    case "workflow":
    case "background-agent":
    case "background-command":
      return "working";
    case "goal":
      return "monitoring";
    case "plan-mode":
      return "plan";
    case "unread-error":
      return "failed";
    default:
      break;
  }
  const { workflows, backgroundAgents, backgroundCommands, planMode, goals } = thread.activity;
  if (workflows + backgroundAgents + backgroundCommands > 0) return "working";
  if (planMode > 0) return "plan";
  if (goals > 0) return "monitoring";
  return "ready";
}

export function isInFlightStatus(status: SidebarThreadStatus): boolean {
  return status === "working" || status === "monitoring" || status === "input";
}

export interface TopStatus {
  label: string;
  icon: "working" | "done" | "monitoring" | null;
  /** Tailwind classes; hues follow t3code (indigo input, sky working, red failed, emerald done, violet plan). */
  className: string;
}

export function resolveTopStatus(input: {
  status: SidebarThreadStatus;
  isUnread: boolean;
  isActive: boolean;
}): TopStatus | null {
  switch (input.status) {
    case "working":
      return {
        label: "Working",
        icon: "working",
        className: input.isActive
          ? "text-sky-600 dark:text-sky-400"
          : "text-sky-600 opacity-75 dark:text-sky-400",
      };
    case "monitoring":
      return {
        label: "Monitoring",
        icon: "monitoring",
        className: "text-sky-600 dark:text-sky-400",
      };
    case "input":
      return {
        label: "Input",
        icon: null,
        className: "text-indigo-600 dark:text-indigo-300",
      };
    case "plan":
      return {
        label: "Plan Ready",
        icon: null,
        className: "text-violet-600 dark:text-violet-300",
      };
    case "failed":
      return {
        label: "Failed",
        icon: null,
        className: "text-red-700 dark:text-red-300",
      };
    case "ready":
      return input.isUnread
        ? {
            label: "Done",
            icon: "done",
            className: "text-emerald-700 dark:text-emerald-300",
          }
        : null;
  }
}

/** In-flight and read-ready rows recede; prominence is for rows needing a human. */
export function shouldRecede(input: {
  status: SidebarThreadStatus;
  isUnread: boolean;
  isActive: boolean;
}): boolean {
  return (
    (input.status === "ready" || isInFlightStatus(input.status)) &&
    !input.isUnread &&
    !input.isActive
  );
}

// ── Titles & time ────────────────────────────────────────────────────
export function threadTitle(thread: Pick<PluginSidebarThread, "title" | "titleFallback">): string {
  return thread.title?.trim() || thread.titleFallback?.trim() || "New thread";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact relative label, t3code style: "now", "5m", "3h", "2d", "Sep 1". */
export function formatCompactTime(timestampMs: number, nowMs: number): string {
  if (!Number.isFinite(timestampMs)) return "";
  const elapsed = Math.max(0, nowMs - timestampMs);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  const date = new Date(timestampMs);
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// ── Auto-settle setting ──────────────────────────────────────────────
const AUTO_SETTLE_MS: Record<string, number> = {
  Never: 0,
  "1 hour": HOUR,
  "6 hours": 6 * HOUR,
  "1 day": DAY,
  "3 days": 3 * DAY,
  "1 week": 7 * DAY,
};

/** 0 means disabled. Unknown values fall back to the default (1 day). */
export function parseAutoSettleMs(value: unknown): number {
  return typeof value === "string" && value in AUTO_SETTLE_MS ? AUTO_SETTLE_MS[value]! : DAY;
}

// ── Partition ────────────────────────────────────────────────────────
export type SidebarSection = "pinned" | "active" | "settled" | "snoozed";

export interface PartitionInput<T extends PluginSidebarThread> {
  threads: readonly T[];
  /** threadId → settledAt (epoch ms). */
  settledAt: Readonly<Record<string, number>>;
  /** Restrict to one project; null shows every project. */
  snoozed?: Readonly<SnoozedMap>;
  scopeProjectId: string | null;
  autoSettleMs: number;
  nowMs: number;
}

export interface Partition<T extends PluginSidebarThread> {
  pinned: T[];
  active: T[];
  settled: T[];
  snoozed: T[];
  /**
   * Explicitly settled threads that woke back up (new attention, unread, or
   * live work). They render as active; the caller should clear their entry
   * so they don't silently re-settle once they go quiet again.
   */
  staleSettledIds: string[];
}

/** A settled thread un-settles the moment it needs the user again. */
export function isSettledEntryStale(
  thread: Pick<
    PluginSidebarThread,
    "isUnread" | "latestAttentionAt" | "indicator" | "hasPendingInteraction" | "activity"
  >,
  settledAtMs: number,
): boolean {
  return (
    thread.isUnread ||
    thread.latestAttentionAt > settledAtMs ||
    resolveThreadStatus(thread) !== "ready"
  );
}

function qualifiesForAutoSettle(
  thread: PluginSidebarThread,
  autoSettleMs: number,
  nowMs: number,
): boolean {
  if (autoSettleMs <= 0 || thread.isUnread || thread.isPinned) return false;
  if (resolveThreadStatus(thread) !== "ready") return false;
  const lastTouch = Math.max(thread.latestAttentionAt, thread.updatedAt);
  return nowMs - lastTouch >= autoSettleMs;
}

export function partitionThreads<T extends PluginSidebarThread>(
  input: PartitionInput<T>,
): Partition<T> {
  const visible = input.threads.filter(
    (thread) =>
      !thread.isArchived &&
      (input.scopeProjectId === null || thread.projectId === input.scopeProjectId),
  );
  const pinned: T[] = [];
  const active: T[] = [];
  const settled: T[] = [];
  const snoozed: T[] = [];
  const staleSettledIds: string[] = [];

  for (const thread of visible) {
    const snooze = input.snoozed?.[thread.id];
    const storedSettledAt = input.settledAt[thread.id];
    const hasSnooze =
      snooze !== undefined && (storedSettledAt === undefined || snooze.at > storedSettledAt);
    if (
      hasSnooze &&
      snooze.until > input.nowMs &&
      !thread.hasPendingInteraction &&
      thread.indicator !== "waiting-for-input"
    ) {
      snoozed.push(thread);
      continue;
    }
    // A reminder must be seen before inactivity can put it back on the shelf.
    const awaitingRead = hasSnooze && (thread.lastReadAt ?? 0) < snooze.until;
    const settledAt = hasSnooze ? undefined : storedSettledAt;
    if (settledAt !== undefined) {
      if (isSettledEntryStale(thread, settledAt)) {
        staleSettledIds.push(thread.id);
      } else {
        settled.push(thread);
        continue;
      }
    } else if (
      !awaitingRead &&
      qualifiesForAutoSettle(
        hasSnooze ? { ...thread, updatedAt: Math.max(thread.updatedAt, snooze.until) } : thread,
        input.autoSettleMs,
        input.nowMs,
      )
    ) {
      settled.push(thread);
      continue;
    }
    (thread.isPinned ? pinned : active).push(thread);
  }

  return {
    pinned: sortByCreated(pinned),
    active: sortByCreated(active),
    settled: sortSettled(settled, input.settledAt),
    snoozed: [...snoozed].sort(
      (a, b) =>
        (input.snoozed?.[a.id]?.until ?? 0) - (input.snoozed?.[b.id]?.until ?? 0) ||
        a.id.localeCompare(b.id),
    ),
    staleSettledIds,
  };
}

// Static order, newest on top. Activity never reorders the list: a row holds
// its position between lifecycle transitions, so the screen only moves when a
// thread enters or leaves a section. Status is carried by the row content.
export function sortByCreated<T extends Pick<PluginSidebarThread, "id" | "createdAt">>(
  threads: readonly T[],
): T[] {
  return [...threads].sort(
    (left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id),
  );
}

/** Settled rows are history: order by when the work ended, not when it began. */
export function settledTimestamp(
  thread: Pick<PluginSidebarThread, "id" | "latestAttentionAt" | "updatedAt">,
  settledAt: Readonly<Record<string, number>>,
): number {
  return settledAt[thread.id] ?? Math.max(thread.latestAttentionAt, thread.updatedAt);
}

export function sortSettled<
  T extends Pick<PluginSidebarThread, "id" | "latestAttentionAt" | "updatedAt">,
>(threads: readonly T[], settledAt: Readonly<Record<string, number>>): T[] {
  return [...threads].sort(
    (left, right) =>
      settledTimestamp(right, settledAt) - settledTimestamp(left, settledAt) ||
      left.id.localeCompare(right.id),
  );
}

// ── Settled shelf visibility ─────────────────────────────────────────
/**
 * Collapsed shelf: only the route's thread stays visible (so the row you are
 * looking at never vanishes). Expanded: a paged tail.
 */
export function visibleSettledThreads<T extends Pick<PluginSidebarThread, "id">>(input: {
  settled: readonly T[];
  expanded: boolean;
  visibleCount: number;
  activeThreadId: string | null;
}): { rows: T[]; hiddenCount: number } {
  if (!input.expanded) {
    const routeThread = input.settled.find((thread) => thread.id === input.activeThreadId);
    return { rows: routeThread ? [routeThread] : [], hiddenCount: 0 };
  }
  const head = input.settled.slice(0, Math.max(0, input.visibleCount));
  const hasActive =
    input.activeThreadId === null || head.some((thread) => thread.id === input.activeThreadId);
  const rows = hasActive
    ? head
    : [...head, ...input.settled.filter((thread) => thread.id === input.activeThreadId)];
  return { rows, hiddenCount: input.settled.length - rows.length };
}

// ── Misc DOM-free helpers ────────────────────────────────────────────
/** A double-click's second `click` (detail 2) must not also navigate. */
export function isTrailingDoubleClick(detail: number): boolean {
  return detail > 1;
}

export function pullRequestBadgeClass(input: {
  state: "closed" | "draft" | "merged" | "open";
  attention: string;
}): string {
  if (input.state === "merged") return "text-violet-600 dark:text-violet-400";
  if (input.state === "closed") return "text-red-600 dark:text-red-400";
  if (input.state === "draft") return "text-muted-foreground";
  switch (input.attention) {
    case "checks_failed":
    case "conflicts":
    case "changes_requested":
    case "blocked":
      return "text-red-600 dark:text-red-400";
    case "checks_pending":
      return "text-amber-600 dark:text-amber-400";
    case "ready_to_merge":
      return "text-emerald-600 dark:text-emerald-400";
    default:
      return "text-green-600 dark:text-green-400";
  }
}
