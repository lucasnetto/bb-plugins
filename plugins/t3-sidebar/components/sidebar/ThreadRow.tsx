import { useLinkedPrs } from "./LinkedPrs";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
} from "@get-bb/plugin-sdk/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  formatCompactTime,
  isTrailingDoubleClick,
  pullRequestBadgeClass,
  resolveThreadStatus,
  resolveTopStatus,
  shouldRecede,
  threadTitle,
  type SidebarSection,
} from "@/lib/sidebar-logic";

export interface ThreadRowProvider {
  displayName: string;
  logoUrl: string | null;
}

export interface ThreadRowActions {
  open: (threadId: string, options?: { split?: boolean }) => void;
  setPinned: (threadId: string, pinned: boolean) => void;
  setRead: (threadId: string, read: boolean) => void;
  rename: (threadId: string, title: string) => void;
  archive: (threadId: string) => void;
  requestDelete: (threadId: string) => void;
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
  actions: ThreadRowActions;
}

/** Deterministic monogram for a project — bb has no favicons for projects. */
function ProjectMark({ name, className }: { name: string | null; className?: string }) {
  const letter = name?.trim().charAt(0).toUpperCase() ?? "";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-muted text-[9px] font-semibold leading-none text-muted-foreground",
        className,
      )}
    >
      {letter || <Icon name="Folder" className="size-3" />}
    </span>
  );
}

function ProviderMark({ provider }: { provider: ThreadRowProvider | null }) {
  if (provider === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 items-center">
          {provider.logoUrl ? (
            <img
              src={provider.logoUrl}
              alt=""
              className="size-3.5 opacity-60 dark:invert-[.85]"
              draggable={false}
            />
          ) : (
            <Icon name="Bot" className="size-3.5 opacity-60" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{provider.displayName}</TooltipContent>
    </Tooltip>
  );
}

function PullRequestBadge({ threadId }: { threadId: string }) {
  const { pullRequest } = experimental_useSidebarThreadPullRequest(threadId);
  const linked = useLinkedPrs(threadId);
  const actions = experimental_useSidebarThreadActions();
  if (linked.length) return <>{linked.map(pr => <a key={pr.url} href={pr.url} onPointerDown={event => event.stopPropagation()} onClick={event => {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    sessionStorage.setItem(`bb:multirepo:open-review:${threadId}`, pr.url);
    actions.open(threadId);
    window.dispatchEvent(new Event('bb:multirepo:open-review'));
  }} className="shrink-0 text-xs tabular-nums hover:underline" title={`${pr.title} (${pr.state}, last fetched)`} aria-label={`${pr.repository} #${pr.number}: ${pr.title} (${pr.state})`}>{pr.repository.split("/").pop()}#{pr.number}</a>)}</>;
  if (pullRequest === null) return null;
  return (
    <a
      href={pullRequest.url}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "shrink-0 text-xs tabular-nums hover:underline",
        pullRequestBadgeClass(pullRequest),
      )}
      aria-label={`Pull request #${pullRequest.number}: ${pullRequest.title} (${pullRequest.state})`}
    >
      #{pullRequest.number}
    </a>
  );
}

function HoverAction({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export const ThreadRow = memo(function ThreadRow(props: ThreadRowProps) {
  const { thread, section, isActive, actions } = props;
  const isCard = section !== "settled";
  const status = resolveThreadStatus(thread);
  const topStatus = resolveTopStatus({ status, isUnread: thread.isUnread, isActive });
  const recede = shouldRecede({ status, isUnread: thread.isUnread, isActive });
  const title = threadTitle(thread);
  const { splitProps, isAvailable: splitAvailable } = experimental_useSidebarThreadSplit(
    thread.id,
  );

  // Inline rename: double-click a row, Enter commits, Escape cancels.
  const [renaming, setRenaming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming !== null) inputRef.current?.select();
  }, [renaming]);
  const commitRename = useCallback(() => {
    if (renaming === null) return;
    const next = renaming.trim();
    if (next !== "" && next !== title) actions.rename(thread.id, next);
    setRenaming(null);
  }, [actions, renaming, thread.id, title]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (renaming !== null || isTrailingDoubleClick(event.detail)) return;
      const wantsSplit = (event.metaKey || event.ctrlKey) && splitAvailable;
      actions.open(thread.id, wantsSplit ? { split: true } : undefined);
    },
    [actions, renaming, splitAvailable, thread.id],
  );
  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      setRenaming(title);
    },
    [title],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLAnchorElement>) => {
      if (renaming !== null) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        actions.open(thread.id);
      } else if (event.key === "F2") {
        event.preventDefault();
        setRenaming(title);
      }
    },
    [actions, renaming, thread.id, title],
  );

  const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();

  const titleNode =
    renaming !== null ? (
      <input
        ref={inputRef}
        autoFocus
        value={renaming}
        aria-label="Thread title"
        onChange={(event) => setRenaming(event.target.value)}
        onBlur={commitRename}
        onClick={stop}
        onDoubleClick={stop}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") commitRename();
          if (event.key === "Escape") setRenaming(null);
        }}
        className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
      />
    ) : (
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          recede ? "font-normal" : "font-medium",
          isCard
            ? thread.isUnread
              ? "text-foreground"
              : recede
                ? "text-muted-foreground"
                : "text-foreground/90"
            : cn(
                "group-hover/row:text-foreground",
                isActive
                  ? "text-foreground"
                  : thread.isUnread
                    ? "text-muted-foreground"
                    : "text-muted-foreground/70",
              ),
        )}
      >
        {title}
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
    !isActive &&
      (status === "working" || status === "monitoring" || status === "input") &&
      "opacity-70 transition-opacity hover:opacity-100",
  );

  const timeLabel = formatCompactTime(props.timeAnchorMs, props.nowMs);

  const menu = (
    <ContextMenuContent className="w-52">
      <ContextMenuItem onSelect={() => actions.open(thread.id)}>Open</ContextMenuItem>
      {splitAvailable ? (
        <ContextMenuItem onSelect={() => actions.open(thread.id, { split: true })}>
          Open in split
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => actions.setPinned(thread.id, !thread.isPinned)}>
        {thread.isPinned ? "Unpin" : "Pin"}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.setRead(thread.id, thread.isUnread)}>
        {thread.isUnread ? "Mark read" : "Mark unread"}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.setSettled(thread.id, section !== "settled")}>
        {section === "settled" ? "Un-settle" : "Settle"}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => setRenaming(title)}>Rename</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => actions.archive(thread.id)}>Archive</ContextMenuItem>
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        onSelect={() => actions.requestDelete(thread.id)}
      >
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );

  const anchorProps = {
    href: `#thread-${thread.id}`,
    "data-sidebar-thread-shortcut-target": "",
    "data-sidebar-thread-id": thread.id,
    "aria-current": isActive ? ("page" as const) : undefined,
    "aria-label": thread.indicatorLabel ? `${title} — ${thread.indicatorLabel}` : title,
    onClick: handleClick,
    onDoubleClick: handleDoubleClick,
    onKeyDown: handleKeyDown,
    ...splitProps,
  };

  if (!isCard) {
    return (
      <li data-thread-item className="list-none">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <a {...anchorProps} className={cn(surfaceClass, "flex h-9 items-center gap-2.5 px-2.5")}>
              {/* Settled history recedes: dimmed mark at rest, restored on hover. */}
              <ProjectMark
                name={props.projectName}
                className={cn(
                  "transition-opacity",
                  !isActive && "opacity-40 group-hover/row:opacity-100",
                )}
              />
              {titleNode}
              {pinIndicator}
              <PullRequestBadge threadId={thread.id} />
              <span className="relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end">
                <span className="inline-flex justify-end text-xs tabular-nums text-muted-foreground/70 transition-opacity group-hover/row:opacity-0">
                  {timeLabel}
                </span>
                <span className="pointer-events-none absolute inset-y-0 right-0 -mr-1 flex items-center opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100">
                  <HoverAction
                    label="Un-settle thread"
                    onClick={(event) => {
                      event.stopPropagation();
                      actions.setSettled(thread.id, false);
                    }}
                  >
                    <Icon name="ArrowTurnBackward" className="mb-px size-3.5" />
                  </HoverAction>
                </span>
              </span>
            </a>
          </ContextMenuTrigger>
          {menu}
        </ContextMenu>
      </li>
    );
  }

  const branch = thread.environment?.branchName ?? null;
  const machine = thread.host?.name ?? thread.environment?.name ?? null;

  return (
    <li data-thread-item className="list-none py-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <a {...anchorProps} className={surfaceClass}>
            <div className="relative z-10 px-2.5 py-2">
              {/* Line 1: project · pin · status / time (hover → settle) */}
              <div className="flex h-5 min-w-0 items-center gap-1.5">
                <ProjectMark name={props.projectName} />
                {props.projectName ? (
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-xs text-muted-foreground",
                      recede ? "font-normal" : "font-medium",
                    )}
                  >
                    {props.projectName}
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                {pinIndicator}
                <span className="group/status relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs">
                  <span
                    className={cn(
                      "pointer-events-none flex items-center self-center tabular-nums text-muted-foreground transition-opacity",
                      "group-hover/row:absolute group-hover/row:right-0 group-hover/row:opacity-0",
                      "group-has-[:focus-visible]/status:absolute group-has-[:focus-visible]/status:right-0 group-has-[:focus-visible]/status:opacity-0",
                    )}
                  >
                    {topStatus ? (
                      <span
                        className={cn("inline-flex items-center gap-1 font-medium", topStatus.className)}
                      >
                        {topStatus.icon === "working" ? (
                          <Icon name="Spinner" className="size-4 shrink-0 animate-spin [animation-duration:2.5s]" />
                        ) : topStatus.icon === "done" ? (
                          <Icon name="CircleCheck" className="size-4 shrink-0" />
                        ) : topStatus.icon === "monitoring" ? (
                          <Icon name="Target" className="size-4 shrink-0" />
                        ) : null}
                        <span role="status">{topStatus.label}</span>
                      </span>
                    ) : (
                      timeLabel
                    )}
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:static group-hover/row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100">
                    {thread.isUnread ? (
                      <HoverAction
                        label="Mark read"
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.setRead(thread.id, true);
                        }}
                      >
                        <Icon name="Check" className="size-3.5" />
                      </HoverAction>
                    ) : null}
                    <HoverAction
                      label="Settle thread"
                      className="-mr-1"
                      onClick={(event) => {
                        event.stopPropagation();
                        actions.setSettled(thread.id, true);
                      }}
                    >
                      <Icon name="Archive" className="size-3.5" />
                      Settle
                    </HoverAction>
                  </span>
                </span>
              </div>
              {/* Line 2: title */}
              <div className="mt-1 flex min-w-0">{titleNode}</div>
              {/* Line 3: branch/machine · PR · provider */}
              <div className="mt-0.5 flex h-4 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {branch ? (
                  <>
                    <Icon
                      name={
                        thread.environment?.workspaceDisplayKind === "other"
                          ? "GitBranch"
                          : "FolderGit"
                      }
                      className="size-3 shrink-0 text-muted-foreground/50"
                    />
                    <span className="min-w-0 flex-1 truncate whitespace-nowrap text-muted-foreground/50">
                      {branch}
                    </span>
                  </>
                ) : machine ? (
                  <span className="min-w-0 flex-1 truncate whitespace-nowrap text-muted-foreground/50">
                    {machine}
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                <PullRequestBadge threadId={thread.id} />
                <span className="ml-auto inline-flex shrink-0 items-center gap-1">
                  <ProviderMark provider={props.provider} />
                </span>
              </div>
            </div>
          </a>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    </li>
  );
});
