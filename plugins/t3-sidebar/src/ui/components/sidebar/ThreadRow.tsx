import { useThreadTitleRegeneration } from "@/ui/hooks/useThreadTitleRegeneration";
import { CardThreadLayout, CompactThreadLayout } from "./ThreadRowLayouts";
import { EditableThreadTitle, useThreadRename } from "./EditableThreadTitle";
import { ThreadContextMenu } from "./ThreadContextMenu";
import { snoozeWakeLabel } from "@/ui/lib/snooze";
import { memo, useCallback } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
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

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        actions.open(thread.id);
      } else if (event.key === "F2") {
        event.preventDefault();
        rename.start();
      }
    },
    [actions, rename, thread.id, title],
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
    "group/row relative block w-full cursor-pointer overflow-hidden rounded-md text-left no-underline outline-none select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
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
    <li data-thread-item className={isCard ? "list-none py-0.5" : "list-none"}>
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
    </li>
  );
});
