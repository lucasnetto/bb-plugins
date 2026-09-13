import { ProjectScopePicker } from "./ProjectScopePicker";
import { useLocalStorageState } from "@/ui/hooks/useLocalStorageState";
import { useSidebarClock } from "@/ui/hooks/useSidebarClock";
import { useSettledThreads } from "@/ui/hooks/useSettledThreads";
import { useSnoozedMap } from "@/ui/lib/use-snoozed-map";
import type { SidebarSection } from "@/ui/lib/sidebar-logic";
import { ProjectDialog } from "./ProjectDialog";
import { LinkedPrProvider } from "./LinkedPrs";
import { useEffect, useMemo, useState } from "react";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import {
  experimental_useProviders,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { TooltipProvider } from "@/ui/components/ui/tooltip";
import { Icon } from "@/ui/components/ui/icon";
import { cn } from "@/ui/lib/utils";
import {
  SETTLED_TAIL_INITIAL_COUNT,
  SETTLED_TAIL_PAGE_COUNT,
  partitionThreads,
  settledTimestamp,
  visibleSettledThreads,
} from "@/ui/lib/sidebar-logic";
import { ThreadRow, type ThreadRowActions, type ThreadRowProvider } from "./ThreadRow";

const SCOPE_KEY = "t3-sidebar:project-scope";
const SETTLED_EXPANDED_KEY = "t3-sidebar:settled-expanded";

function ShelfHeader(props: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
        className="mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
      >
        <span className="text-xs font-medium text-muted-foreground/50">
          {props.expanded ? props.label : `${props.label} (${props.count})`}
        </span>
        <span className="h-px flex-1 bg-border/60" />
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3 text-muted-foreground/50 transition-transform",
            props.expanded && "rotate-180",
          )}
        />
      </button>
    </li>
  );
}

export function T3ThreadList(props: PluginThreadListProps) {
  return (
    <LinkedPrProvider>
      <T3ThreadListContent {...props} />
    </LinkedPrProvider>
  );
}
function T3ThreadListContent(props: PluginThreadListProps) {
  const [projectDialog, setProjectDialog] = useState(false);
  const navigate = useBbNavigate();
  const { activeThreadId, onNavigate } = props;
  const { status, threads: liveThreads, projects } = experimental_useSidebarThreads();
  const hostActions = experimental_useSidebarThreadActions();
  const { providers } = experimental_useProviders();
  const { archivedThreads, threads, set: setSettled, refetch } = useSettledThreads(liveThreads);
  // Native unarchive/rename actions also invalidate the host sidebar query.
  useEffect(refetch, [liveThreads, refetch]);
  const archivedIds = useMemo(
    () => new Set(archivedThreads.map((thread) => thread.id)),
    [archivedThreads],
  );
  const { snoozed, set: setSnoozed } = useSnoozedMap();
  const nowMs = useSidebarClock(snoozed);
  const [snoozedExpanded, setSnoozedExpanded] = useLocalStorageState(
    "t3-sidebar:snoozed-expanded",
    false,
  );

  const [scopeProjectId, setScopeProjectId] = useLocalStorageState<string | null>(SCOPE_KEY, null);
  const [settledExpanded, setSettledExpanded] = useLocalStorageState(SETTLED_EXPANDED_KEY, false);

  // A scope pointing at a project that no longer exists falls back to all.
  const effectiveScope =
    scopeProjectId !== null && projects.some((project) => project.id === scopeProjectId)
      ? scopeProjectId
      : null;
  const [settledPagination, setSettledPagination] = useState({
    scope: effectiveScope,
    visibleCount: SETTLED_TAIL_INITIAL_COUNT,
  });
  if (settledPagination.scope !== effectiveScope) {
    setSettledPagination({
      scope: effectiveScope,
      visibleCount: SETTLED_TAIL_INITIAL_COUNT,
    });
  }
  const settledVisibleCount =
    settledPagination.scope === effectiveScope
      ? settledPagination.visibleCount
      : SETTLED_TAIL_INITIAL_COUNT;

  const partition = useMemo(
    () =>
      partitionThreads({
        threads,
        snoozed,
        scopeProjectId: effectiveScope,
        nowMs,
      }),
    [effectiveScope, nowMs, snoozed, threads],
  );

  const { rows: settledRows, hiddenCount: hiddenSettledCount } = useMemo(
    () =>
      visibleSettledThreads({
        settled: partition.settled,
        expanded: settledExpanded,
        visibleCount: settledVisibleCount,
        activeThreadId,
      }),
    [activeThreadId, partition.settled, settledExpanded, settledVisibleCount],
  );

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const providerById = useMemo(
    () =>
      new Map<string, ThreadRowProvider>(
        providers.map((provider) => [
          provider.id,
          { displayName: provider.displayName, logoUrl: provider.logoUrl },
        ]),
      ),
    [providers],
  );

  const rowActions = useMemo<ThreadRowActions>(
    () => ({
      open: (threadId, options) => {
        if (archivedIds.has(threadId)) navigate.toThread(threadId);
        else hostActions.open(threadId, options);
        onNavigate();
      },
      setPinned: (threadId, pinned) => void hostActions.setPinned(threadId, pinned),
      setRead: (threadId, read) => void hostActions.setRead(threadId, read),
      rename: (threadId, title) => {
        void hostActions.rename(threadId, title).then(refetch);
      },
      requestDelete: (threadId) => hostActions.requestDelete(threadId),
      setSnoozed,
      setSettled,
    }),
    [hostActions, onNavigate, setSettled, setSnoozed, archivedIds, navigate, refetch],
  );

  const renderRow = (thread: PluginSidebarThread, section: SidebarSection) => (
    <ThreadRow
      key={`${thread.id}:${section === "settled" ? "slim" : "card"}`}
      thread={thread}
      section={section}
      isActive={thread.id === activeThreadId}
      projectName={projectNameById.get(thread.projectId) ?? null}
      provider={providerById.get(thread.providerId) ?? null}
      timeAnchorMs={section === "settled" ? settledTimestamp(thread) : thread.updatedAt}
      snoozedUntil={section === "snoozed" ? snoozed[thread.id]?.until : undefined}
      nowMs={nowMs}
      actions={rowActions}
    />
  );

  const total =
    partition.pinned.length +
    partition.active.length +
    partition.settled.length +
    partition.snoozed.length;
  const scopedProject = projects.find((project) => project.id === effectiveScope) ?? null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col pb-1">
        {projectDialog ? (
          <ProjectDialog onClose={() => setProjectDialog(false)} onCreated={setScopeProjectId} />
        ) : null}
        <ProjectScopePicker
          projects={projects}
          scopeProjectId={effectiveScope}
          onChange={setScopeProjectId}
          onAddProject={() => setProjectDialog(true)}
          onProjectSettings={(project) => {
            navigate.toPluginPanel("projects", { subPath: project.id });
            onNavigate();
          }}
          onNewThread={() => {
            if (effectiveScope)
              navigate.toPluginPanel("projects", {
                subPath: `${effectiveScope}/new`,
              });
            onNavigate();
          }}
        />
        <ul role="list" className="flex flex-col gap-px px-1.5">
          {partition.pinned.map((thread) => renderRow(thread, "pinned"))}
          {partition.pinned.length > 0 ? (
            <li aria-hidden className="mx-2.5 my-1.5 h-px list-none bg-border/60" />
          ) : null}
          {partition.active.map((thread) => renderRow(thread, "active"))}
          {partition.snoozed.length > 0 ? (
            <ShelfHeader
              label="Snoozed"
              count={partition.snoozed.length}
              expanded={snoozedExpanded}
              onToggle={() => setSnoozedExpanded((value) => !value)}
            />
          ) : null}
          {partition.snoozed
            .filter((thread) => snoozedExpanded || thread.id === activeThreadId)
            .map((thread) => renderRow(thread, "snoozed"))}
          {partition.settled.length > 0 ? (
            <ShelfHeader
              label="Settled"
              count={partition.settled.length}
              expanded={settledExpanded}
              onToggle={() => setSettledExpanded((value) => !value)}
            />
          ) : null}
          {settledRows.map((thread) => renderRow(thread, "settled"))}
          {settledExpanded && hiddenSettledCount > 0 ? (
            <li className="list-none">
              <button
                type="button"
                onClick={() =>
                  setSettledPagination((pagination) => ({
                    ...pagination,
                    visibleCount: pagination.visibleCount + SETTLED_TAIL_PAGE_COUNT,
                  }))
                }
                className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-muted-foreground/55 hover:bg-state-hover hover:text-foreground"
              >
                <Icon name="Plus" className="size-4 shrink-0" />
                Show {Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more
              </button>
            </li>
          ) : null}
        </ul>
        {total === 0 ? (
          <div
            role="status"
            className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60"
          >
            {status === "loading"
              ? "Loading threads…"
              : status === "error"
                ? "Could not load threads"
                : scopedProject
                  ? `No threads in ${scopedProject.name} yet`
                  : "No threads yet"}
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
