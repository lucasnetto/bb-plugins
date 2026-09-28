import type { ThreadTreeRow } from "@/ui/lib/thread-tree";
import { useThreadTitleRegeneration } from "@/ui/hooks/useThreadTitleRegeneration";
import { CardThreadLayout, CompactThreadLayout } from "./ThreadRowLayouts";
import { EditableThreadTitle, useThreadRename } from "./EditableThreadTitle";
import { ThreadContextMenu } from "./ThreadContextMenu";
import { snoozeWakeLabel } from "@/ui/lib/snooze";
import { memo, useCallback } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { experimental_useSidebarThreadSplit } from "@get-bb/plugin-sdk/app";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/ui/tooltip";
import { Icon } from "@/ui/components/ui/icon";
import { cn } from "@/ui/lib/utils";
import {
  formatCompactTime,
  isInFlightStatus,
  isTrailingDoubleClick,
  resolveThreadStatus,
  resolveTopStatus,
  shouldRecede,
  threadTitle,
  type SidebarSection,
} from "@/ui/lib/sidebar-logic";

export interface ThreadRowProvider {
  displayName: string;
  logoUrl: string | null;
}

export interface ThreadRowActions {
  open: (threadId: string, options?: { split?: boolean }) => void;
  setPinned: (threadId: string, pinned: boolean) => void;
  setRead: (threadId: string, read: boolean) => void;
  rename: (threadId: string, title: string) => void;
  requestDelete: (threadId: string) => void;
  setSnoozed: (threadId: string, until: number | null) => void;
  setSettled: (threadId: string, settled: boolean) => void;
}

export interface ThreadRowProps {
  thread: PluginSidebarThread;
  section: SidebarSection;
  isActive: boolean;
  projectName: string | null;
  provider: ThreadRowProvider | null;
  /** Epoch ms the row's time label counts from. */
  timeAnchorMs: number;
  nowMs: number;
  snoozedUntil?: number;
  actions: ThreadRowActions;
  tree?: Omit<ThreadTreeRow, "thread" | "parentId"> & { onToggle: () => void };
  reorder?: {
    group: string;
    dragging: boolean;
    edge: "before" | "after" | null;
    onPointerDown: (event: PointerEvent) => void;
    onMove: (direction: -1 | 1) => void;
  };
}

export const ThreadRow = memo(function ThreadRow(props: ThreadRowProps) {
  const { thread, section, isActive, actions } = props;
  const isCard = section !== "settled";
  const isSnoozed = section === "snoozed";
  const status = resolveThreadStatus(thread);
  const topStatus = resolveTopStatus({ status, isUnread: thread.isUnread, isActive });
  const recede = shouldRecede({ status, isUnread: thread.isUnread, isActive });
  const title = threadTitle(thread);
  const { splitProps, isAvailable: splitAvailable } = experimental_useSidebarThreadSplit(thread.id);

  const rename = useThreadRename(title, (next) => actions.rename(thread.id, next));
  const regeneration = useThreadTitleRegeneration(thread.id);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();

      if (rename.draft !== null || isTrailingDoubleClick(event.detail)) return;
      const wantsSplit = (event.metaKey || event.ctrlKey) && splitAvailable;
      actions.open(thread.id, wantsSplit ? { split: true } : undefined);
    },
    [actions, rename, splitAvailable, thread.id],
  );

  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      rename.start();
    },
    [rename],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLAnchorElement>) => {
      if (rename.draft !== null) return;

      if (props.reorder && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        event.stopPropagation();
        props.reorder.onMove(event.key === "ArrowUp" ? -1 : 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        actions.open(thread.id);
      } else if (event.key === "F2") {
        event.preventDefault();
        rename.start();
      }
    },
    [actions, rename, thread.id, props.reorder],
  );

  const titleNode = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <EditableThreadTitle
        rename={rename}
        title={title}
        recede={recede}
        isCard={isCard}
        isActive={isActive}
        isUnread={thread.isUnread}
      />
      {regeneration.running && (
        <span
          role="status"
          aria-live="polite"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
        >
          <Icon
            name="Spinner"
            aria-hidden
            className="size-3 animate-spin motion-reduce:animate-none"
          />
          Renaming…
        </span>
      )}
    </span>
  );

  const pinIndicator = thread.isPinned ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Unpin thread"
          onClick={(event) => {
            event.stopPropagation();
            actions.setPinned(thread.id, false);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="inline-flex cursor-pointer items-center rounded-sm text-muted-foreground/65 outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="Pin" className="size-3 shrink-0" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Unpin thread</TooltipContent>
    </Tooltip>
  ) : null;

  const surfaceClass = cn(
    "group/row relative block min-w-0 w-full cursor-pointer overflow-hidden rounded-md text-left no-underline outline-none select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
    isActive
      ? "bg-state-active text-foreground"
      : recede
        ? "text-muted-foreground/75 hover:bg-state-hover hover:text-foreground"
        : "bg-transparent text-foreground hover:bg-state-hover",
    !isActive && isInFlightStatus(status) && "opacity-70 transition-opacity hover:opacity-100",
  );

  const wakeLabel =
    isSnoozed && props.snoozedUntil !== undefined
      ? snoozeWakeLabel(props.snoozedUntil, props.nowMs)
      : undefined;

  const timeLabel = formatCompactTime(props.timeAnchorMs, props.nowMs);

  const anchorProps = {
    href: `#thread-${thread.id}`,
    "data-sidebar-thread-shortcut-target": "",
    "data-sidebar-thread-id": thread.id,
    "aria-current": isActive ? ("page" as const) : undefined,
    "aria-label": thread.indicatorLabel ? `${title} — ${thread.indicatorLabel}` : title,
    onClick: handleClick,
    onDoubleClick: handleDoubleClick,
    onKeyDown: handleKeyDown,
    "aria-keyshortcuts": props.reorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined,
  };

  if (!thread.isArchived) Object.assign(anchorProps, splitProps);

  const layout = isCard ? (
    <CardThreadLayout
      thread={thread}
      actions={actions}
      projectName={props.projectName}
      provider={props.provider}
      recede={recede}
      topStatus={topStatus}
      wakeLabel={wakeLabel}
      timeLabel={timeLabel}
      titleNode={titleNode}
      pinIndicator={pinIndicator}
    />
  ) : (
    <CompactThreadLayout
      thread={thread}
      actions={actions}
      projectName={props.projectName}
      isActive={isActive}
      timeLabel={timeLabel}
      titleNode={titleNode}
      pinIndicator={pinIndicator}
    />
  );

  return (
    <li
      style={{ marginLeft: Math.min(props.tree?.depth ?? 0, 5) * 24 }}
      data-thread-depth={props.tree?.depth ?? 0}
      data-thread-item
      data-reorder-id={props.reorder ? thread.id : undefined}
      data-reorder-group={props.reorder?.group}
      onPointerDown={rename.draft === null ? props.reorder?.onPointerDown : undefined}
      onDragStart={props.reorder ? (event) => event.preventDefault() : undefined}
      className={cn(
        "relative list-none",
        isCard && !props.tree?.depth && "py-0.5",
        props.tree?.startsFamily && "mt-2",
        props.reorder?.dragging && "opacity-40",
      )}
    >
      {props.tree && (
        <span aria-hidden className="pointer-events-none absolute inset-0 text-muted-foreground/45">
          {props.tree.ancestorContinues.map((continues, level) =>
            continues && level < 4 ? (
              <span
                key={level}
                className="absolute -top-px -bottom-px border-l"
                style={{
                  left: (level + 1 - Math.min(props.tree!.depth, 5)) * 24 + 16,
                  borderColor: "currentColor",
                }}
              />
            ) : null,
          )}
          {props.tree.depth > 0 && (
            <>
              <span
                className="absolute -top-px border-l"
                style={{
                  left: -8,
                  bottom: props.tree.isLastChild ? "50%" : -1,
                  borderColor: "currentColor",
                }}
              />
              <span
                className="absolute top-1/2 w-8 border-t"
                style={{ left: -8, borderColor: "currentColor" }}
              />
            </>
          )}
          {props.tree.hasChildren && props.tree.expanded && (
            <span
              className="absolute top-1/2 -bottom-px border-l"
              style={{ left: 16, borderColor: "currentColor" }}
            />
          )}
        </span>
      )}
      {props.reorder?.edge ? (
        <span
          aria-hidden
          data-reorder-edge={props.reorder.edge}
          className={cn(
            "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-primary",
            props.reorder.edge === "before" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}
      <div className="flex min-w-0 items-center">
        {props.tree?.hasChildren ? (
          <button
            type="button"
            aria-label={`${props.tree.expanded ? "Collapse" : "Expand"} children of ${title}`}
            aria-expanded={props.tree.expanded}
            onClick={props.tree.onToggle}
            onPointerDown={(event) => event.stopPropagation()}
            title={`${props.tree.childCount} ${props.tree.childCount === 1 ? "child thread" : "child threads"}`}
            className="relative z-10 flex h-7 w-8 shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded bg-sidebar text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon
              name="ChevronDown"
              className={cn("size-3", !props.tree.expanded && "-rotate-90")}
            />
            <span aria-hidden className="text-[10px] font-medium tabular-nums">
              {props.tree.childCount}
            </span>
          </button>
        ) : (
          <span aria-hidden className="w-8 shrink-0" />
        )}
        <ThreadContextMenu
          thread={thread}
          section={section}
          actions={actions}
          splitAvailable={splitAvailable}
          onRename={rename.start}
          regeneration={regeneration}
        >
          <a
            {...anchorProps}
            className={
              isCard ? surfaceClass : cn(surfaceClass, "flex h-9 items-center gap-2.5 px-2.5")
            }
          >
            {layout}
          </a>
        </ThreadContextMenu>
      </div>
    </li>
  );
});
