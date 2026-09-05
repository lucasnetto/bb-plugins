import { useSnoozedMap } from "@/ui/lib/use-snoozed-map";
import type { SidebarSection } from "@/ui/lib/sidebar-logic";
import { ProjectDialog } from "./ProjectDialog";
import { Button } from "@/ui/components/ui/button";
import { LinkedPrProvider } from "./LinkedPrs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import {
  experimental_useProviders,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, SettledMap } from "../../../shared/rpc-contract";
import { SETTLED_CHANGED } from "@/shared/contract";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { TooltipProvider } from "@/ui/components/ui/tooltip";
import { Icon } from "@/ui/components/ui/icon";
import { cn } from "@/ui/lib/utils";
import {
  SETTLED_TAIL_INITIAL_COUNT,
  SETTLED_TAIL_PAGE_COUNT,
  parseAutoSettleMs,
  partitionThreads,
  settledTimestamp,
  visibleSettledThreads,
} from "@/ui/lib/sidebar-logic";
import { ThreadRow, type ThreadRowActions, type ThreadRowProvider } from "./ThreadRow";

const SCOPE_KEY = "t3-sidebar:project-scope";
const SETTLED_EXPANDED_KEY = "t3-sidebar:settled-expanded";

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function useLocalStorageState<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStorage(key, fallback));
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage may be unavailable (private mode); the in-memory value still works.
    }
  }, [key, value]);
  return [value, setValue];
}

/** One clock for labels and exact snooze deadlines; refresh after backgrounding. */
function useNowMinute(snoozed: import("../../../shared/snooze-contract").SnoozedMap): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const nextWake = Math.min(
        ...Object.values(snoozed).map(({ until }) => (until > current ? until : Infinity)),
      );
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, Math.min(60_000, nextWake - current));
    };
    tick();
    window.addEventListener("focus", tick);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", tick);
    };
  }, [snoozed]);
  return now;
}

/** The plugin-owned settled map, kept current by the server's realtime signal. */
function useSettledMap() {
  const rpc = useRpc<typeof rpcContract>();
  const [settled, setSettled] = useState<SettledMap>({});
  const refetch = useCallback(() => {
    rpc.call("settled_list").then(
      (result) => setSettled(result.settled),
      (cause: unknown) => console.warn("[t3-sidebar] settled_list failed", cause),
    );
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime(SETTLED_CHANGED, refetch);
  const set = useCallback(
    (threadIds: readonly string[], value: boolean) => {
      if (threadIds.length === 0) return;
      // Optimistic: the row moves immediately; the realtime echo confirms it.
      setSettled((current) => {
        const now = Date.now();
        return value
          ? {
              ...current,
              ...Object.fromEntries(threadIds.map((id) => [id, now])),
            }
          : Object.fromEntries(Object.entries(current).filter(([id]) => !threadIds.includes(id)));
      });
      rpc.call("settled_set", { threadIds: [...threadIds], settled: value }).then(
        (result) => setSettled(result.settled),
        (cause: unknown) => {
          toast.error(value ? "Could not settle thread" : "Could not un-settle thread");
          console.warn("[t3-sidebar] settled_set failed", cause);
          refetch();
        },
      );
    },
    [refetch, rpc],
  );
  return { settled, set };
}

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

function ProjectScopePicker(props: {
  projects: readonly { id: string; name: string; isPersonal: boolean }[];
  scopeProjectId: string | null;
  onChange: (projectId: string | null) => void;
  onNewThread: () => void;
  onAddProject: () => void;
  onProjectSettings: (project: { id: string; name: string }) => void;
}) {
  const scoped = props.projects.find((project) => project.id === props.scopeProjectId) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const openingSettings = useRef(false);
  const matchingProjects = props.projects.filter((project) =>
    project.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="flex items-center gap-1 px-1.5 pb-1 pt-1.5">
      <DropdownMenu
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            setQuery("");
            openingSettings.current = false;
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Filter threads by project"
            className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-foreground/90 outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-state-active"
          >
            <Icon name="Folder" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{scoped?.name ?? "All projects"}</span>
            <Icon name="ChevronDown" className="-mr-px size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-56"
          onCloseAutoFocus={(event) => {
            if (openingSettings.current) event.preventDefault();
          }}
        >
          <input
            aria-label="Search projects"
            placeholder="Search projects…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
            }}
            className="mb-1 h-8 w-full border-b bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
          />
          <DropdownMenuItem
            onSelect={() => props.onChange(null)}
            className={cn(props.scopeProjectId === null && "font-medium")}
          >
            <Icon name="Folder" className="size-4" />
            All projects
          </DropdownMenuItem>
          {props.projects.length > 0 ? <DropdownMenuSeparator /> : null}
          {matchingProjects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={(event) => {
                if (openingSettings.current) event.preventDefault();
                else props.onChange(project.id);
              }}
              className={cn(project.id === props.scopeProjectId && "font-medium")}
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-muted text-[9px] font-semibold text-muted-foreground">
                {project.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {!project.isPersonal ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`Project settings for ${project.name}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    openingSettings.current = true;
                    setOpen(false);
                    props.onProjectSettings(project);
                  }}
                >
                  <Icon name="Settings" className="size-3.5" />
                </Button>
              ) : null}
            </DropdownMenuItem>
          ))}
          {!matchingProjects.length ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No matching projects.</p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground"
        aria-label="New project"
        onClick={props.onAddProject}
      >
        <Icon name="FolderPlus" className="size-4" />
      </Button>
      {scoped ? (
        <button
          type="button"
          aria-label={`New thread in ${scoped.name}`}
          title={`New thread in ${scoped.name}`}
          onClick={props.onNewThread}
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="Plus" className="size-4" />
        </button>
      ) : null}
    </div>
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
  const { status, threads, projects } = experimental_useSidebarThreads();
  const hostActions = experimental_useSidebarThreadActions();
  const { providers } = experimental_useProviders();
  const settings = useSettings();
  const { settled: settledAt, set: setSettled } = useSettledMap();
  const { snoozed, set: setSnoozed } = useSnoozedMap();
  const nowMs = useNowMinute(snoozed);
  const [snoozedExpanded, setSnoozedExpanded] = useLocalStorageState(
    "t3-sidebar:snoozed-expanded",
    false,
  );

  const [scopeProjectId, setScopeProjectId] = useLocalStorageState<string | null>(SCOPE_KEY, null);
  const [settledExpanded, setSettledExpanded] = useLocalStorageState(SETTLED_EXPANDED_KEY, false);
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_TAIL_INITIAL_COUNT);

  // A scope pointing at a project that no longer exists falls back to all.
  const effectiveScope =
    scopeProjectId !== null && projects.some((project) => project.id === scopeProjectId)
      ? scopeProjectId
      : null;
  useEffect(() => {
    setSettledVisibleCount(SETTLED_TAIL_INITIAL_COUNT);
  }, [effectiveScope]);

  const autoSettleMs = parseAutoSettleMs(settings.values?.autoSettleAfter);

  const partition = useMemo(
    () =>
      partitionThreads({
        threads,
        settledAt,
        snoozed,
        scopeProjectId: effectiveScope,
        autoSettleMs,
        nowMs,
      }),
    [autoSettleMs, effectiveScope, nowMs, settledAt, snoozed, threads],
  );

  // A settled thread that woke up must lose its entry, or it would silently
  // re-settle the moment it goes quiet. Cleared once per id per wake.
  const clearedStaleRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = partition.staleSettledIds.filter((id) => !clearedStaleRef.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) clearedStaleRef.current.add(id);
    setSettled(fresh, false);
  }, [partition.staleSettledIds, setSettled]);
  useEffect(() => {
    for (const id of clearedStaleRef.current) {
      if (!(id in settledAt)) clearedStaleRef.current.delete(id);
    }
  }, [settledAt]);

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
        hostActions.open(threadId, options);
        onNavigate();
      },
      setPinned: (threadId, pinned) => void hostActions.setPinned(threadId, pinned),
      setRead: (threadId, read) => void hostActions.setRead(threadId, read),
      rename: (threadId, title) => void hostActions.rename(threadId, title),
      archive: (threadId) => hostActions.archive(threadId),
      requestDelete: (threadId) => hostActions.requestDelete(threadId),
      setSnoozed,
      setSettled: (threadId, value) => setSettled([threadId], value),
    }),
    [hostActions, onNavigate, setSettled, setSnoozed],
  );

  const renderRow = (thread: PluginSidebarThread, section: SidebarSection) => (
    <ThreadRow
      key={`${thread.id}:${section === "settled" ? "slim" : "card"}`}
      thread={thread}
      section={section}
      isActive={thread.id === activeThreadId}
      projectName={projectNameById.get(thread.projectId) ?? null}
      provider={providerById.get(thread.providerId) ?? null}
      timeAnchorMs={section === "settled" ? settledTimestamp(thread, settledAt) : thread.updatedAt}
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
                onClick={() => setSettledVisibleCount((count) => count + SETTLED_TAIL_PAGE_COUNT)}
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
