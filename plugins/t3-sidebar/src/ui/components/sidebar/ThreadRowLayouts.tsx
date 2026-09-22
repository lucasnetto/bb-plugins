import { Match } from "effect";
import type { MouseEvent, ReactNode } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
} from "@get-bb/plugin-sdk/app";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/ui/tooltip";
import { Icon } from "@/ui/components/ui/icon";
import { cn } from "@/ui/lib/utils";
import { pullRequestBadgeClass, type TopStatus } from "@/ui/lib/sidebar-logic";
import { requestLinkedReview } from "@/ui/lib/pr-review-navigation";
import { ThreadSnoozeMenu } from "./ThreadSnoozeMenu";
import { useLinkedPrs } from "./LinkedPrs";
import type { ThreadRowProps, ThreadRowProvider } from "./ThreadRow";

type ThreadLayoutProps = Pick<ThreadRowProps, "thread" | "actions" | "projectName"> & {
  titleNode: ReactNode;
  pinIndicator: ReactNode;
  timeLabel: string;
};

export function CompactThreadLayout({
  thread,
  actions,
  projectName,
  isActive,
  titleNode,
  pinIndicator,
  timeLabel,
}: ThreadLayoutProps & {
  isActive: boolean;
}) {
  return (
    <>
      {/* Settled history recedes: dimmed mark at rest, restored on hover. */}
      <ProjectMark
        name={projectName}
        className={cn("transition-opacity", !isActive && "opacity-40 group-hover/row:opacity-100")}
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
    </>
  );
}

export function CardThreadLayout({
  thread,
  actions,
  projectName,
  provider,
  recede,
  topStatus,
  wakeLabel,
  timeLabel,
  titleNode,
  pinIndicator,
}: ThreadLayoutProps & {
  provider: ThreadRowProvider | null;
  recede: boolean;
  topStatus: TopStatus | null;
  wakeLabel?: string;
}) {
  const branch = thread.environment?.branchName ?? null;
  const machine = thread.host?.name ?? thread.environment?.name ?? null;

  return (
    <div className="relative z-10 px-2.5 py-2">
      {/* Line 1: project · pin · status / time (hover → settle) */}
      <div className="flex h-5 min-w-0 items-center gap-1.5">
        <ProjectMark name={projectName} />
        {projectName ? (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs text-muted-foreground",
              recede ? "font-normal" : "font-medium",
            )}
          >
            {projectName}
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
                {Match.value(topStatus.icon).pipe(
                  Match.when("working", () => (
                    <Icon
                      name="Spinner"
                      className="size-4 shrink-0 animate-spin [animation-duration:2.5s]"
                    />
                  )),
                  Match.when("input", () => (
                    <Icon name="MessageQuestion" className="size-4 shrink-0" />
                  )),
                  Match.when("done", () => <Icon name="CircleCheck" className="size-4 shrink-0" />),
                  Match.when("monitoring", () => (
                    <Icon name="Target" className="size-4 shrink-0" />
                  )),
                  Match.orElse(() => null),
                )}
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
            {wakeLabel !== undefined ? (
              <HoverAction
                label="Wake now"
                onClick={(event) => {
                  event.stopPropagation();
                  actions.setSnoozed(thread.id, null);
                }}
              >
                <Icon name="ArrowTurnBackward" className="size-3.5" />
              </HoverAction>
            ) : null}
            {!thread.hasPendingInteraction && thread.indicator !== "waiting-for-input" ? (
              <ThreadSnoozeMenu onSnooze={(until) => actions.setSnoozed(thread.id, until)} />
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
      {wakeLabel !== undefined ? (
        <div className="mt-1 text-xs tabular-nums text-muted-foreground">Wakes {wakeLabel}</div>
      ) : null}
      {/* Environment and PRs share a line without squeezing the environment. */}
      <div className="mt-0.5 flex min-h-4 min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {machine || branch ? (
          <div className="mr-auto flex min-w-0 max-w-full shrink-0 flex-wrap items-start gap-x-1.5 gap-y-1 text-muted-foreground/50">
            {machine ? (
              <span className="min-w-0 max-w-full whitespace-normal break-all">{machine}</span>
            ) : null}
            {branch ? (
              <span className="flex min-w-0 max-w-full items-start gap-1.5">
                <Icon
                  name={
                    thread.environment?.workspaceDisplayKind === "other" ? "GitBranch" : "FolderGit"
                  }
                  className="mt-0.5 size-3 shrink-0"
                />
                <span className="min-w-0 flex-1 whitespace-normal break-all">{branch}</span>
              </span>
            ) : null}
          </div>
        ) : (
          <span className="flex-1" />
        )}
        <PullRequestBadge threadId={thread.id} />
        <span className="inline-flex shrink-0 items-center gap-1">
          <ProviderMark provider={provider} />
        </span>
      </div>
    </div>
  );
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

  if (linked.length)
    return (
      <>
        {linked.map((pr) => (
          <a
            key={pr.url}
            href={pr.url}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();

              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              requestLinkedReview(threadId, pr.url, (id) => actions.open(id));
            }}
            className={cn(
              "max-w-full shrink-0 break-all text-xs tabular-nums hover:underline",
              pullRequestBadgeClass(pr),
            )}
            title={`${pr.title} (${pr.state}, last fetched)`}
            aria-label={`${pr.repository} #${pr.number}: ${pr.title} (${pr.state})`}
          >
            {pr.repository.split("/").pop()}#{pr.number}
          </a>
        ))}
      </>
    );

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
