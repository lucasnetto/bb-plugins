import { useEffect, useMemo, useRef, useState } from "react";
import { useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { Button } from "../ui/components/ui/button";
import { ReviewToolbar } from "../ui/review/ReviewToolbar";
import { ResizableFilesSidebar } from "../ui/review/ResizableFilesSidebar";
import { ChangeTree } from "./ChangeTree";
import { StyledDiffCodeView } from "../ui/review/StyledDiffCodeView";
import type { localRpcContract, Snapshot, CheckoutDiff } from "./contract";

import { useLocalDiffView } from "./useLocalDiffView";

export function LocalChangesPanel({ threadId }: PluginThreadPanelProps) {
  return <LocalChanges key={threadId} threadId={threadId} />;
}

function LocalChanges({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof localRpcContract>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [loadingDiffs, setLoadingDiffs] = useState(false);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [previews, setPreviews] = useState<ReadonlyMap<string, CheckoutDiff>>(new Map());
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [treeWidth, setTreeWidth] = useState<number | null>(null);
  const [treeOpen, setTreeOpen] = useState(true);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, 10000);

        return;
      }

      setScanning(true);

      try {
        const result = await rpc.call("localSnapshot", { threadId });

        if (!disposed) {
          snapshotRef.current = result;
          setSnapshot(result);
          setError("");

          const changed = new Set(
            result.checkouts.flatMap((checkout) =>
              checkout.changes.length ? [checkout.path] : [],
            ),
          );

          setExpandedPath((previous) => (previous && changed.has(previous) ? previous : null));
          setPreviews((previous) => new Map([...previous].filter(([path]) => changed.has(path))));
        }
      } catch (cause) {
        if (!disposed) setError(String(cause));
      } finally {
        if (!disposed) {
          setScanning(false);
          timer = setTimeout(poll, 10000);
        }
      }
    }

    void poll();

    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [rpc, threadId, refresh]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    setLoadingDiffs(false);

    if (!expandedPath) return;
    const checkout = expandedPath;

    async function poll() {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, 10000);

        return;
      }

      setLoadingDiffs(true);
      let files: CheckoutDiff;

      try {
        files = await rpc.call("localCheckoutDiff", { threadId, checkout });
      } catch (cause) {
        files = (
          snapshotRef.current?.checkouts.find((entry) => entry.path === checkout)?.changes ?? []
        ).map((change) => ({ path: change.path, patch: "", notice: String(cause) }));
      }

      if (disposed) return;
      setPreviews((previous) => {
        const next = new Map(previous);
        next.delete(checkout);
        next.set(checkout, files);

        // Keep recent workspaces ready without retaining every checkout's diff payload.
        while (next.size > 3) next.delete(next.keys().next().value!);

        return next;
      });
      setLoadingDiffs(false);
      timer = setTimeout(poll, 10000);
    }

    void poll();

    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [rpc, threadId, refresh, expandedPath]);

  const busy = scanning || loadingDiffs;

  const checkouts = useMemo(
    () =>
      snapshot?.checkouts.map((checkout) => ({
        ...checkout,
        changes: [...new Map(checkout.changes.map((change) => [change.path, change])).values()],
      })) ?? [],
    [snapshot],
  );

  const current = checkouts.find((checkout) => checkout.current);

  const visible = useMemo(
    () =>
      checkouts.filter(
        (checkout) => checkout.changes.length > 0 && (showAll || !current || checkout.current),
      ),
    [checkouts, showAll, current],
  );

  const expanded = useMemo(
    () => visible.filter((checkout) => checkout.path === expandedPath),
    [visible, expandedPath],
  );

  const diff = useLocalDiffView(expanded, previews);
  const active = diff.active;

  const warnings = [
    ...(snapshot?.warnings ?? []),
    ...(snapshot?.checkouts.flatMap((checkout) =>
      checkout.error ? [`${checkout.path}: ${checkout.error}`] : [],
    ) ?? []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={snapshot?.root}
        >
          {snapshot?.root ?? "Loading local changes…"}
        </span>
        {current ? (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={showAll}
            onClick={() => {
              setShowAll(!showAll);

              if (showAll && expandedPath !== current.path) setExpandedPath(null);
            }}
          >
            {showAll ? "All worktrees" : "Current checkout"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {busy ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      <ReviewToolbar
        fileCount={expanded[0]?.changes.length ?? 0}
        guideOpen={false}
        treeOpen={treeOpen}
        onToggleTree={() => setTreeOpen(!treeOpen)}
        loading={busy}
        display={diff.display}
      />
      {error ? (
        <p role="alert" className="p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {warnings.length ? (
        <details className="border-b px-3 py-2 text-xs text-muted-foreground">
          <summary>Some directories could not be scanned ({warnings.length})</summary>
          {warnings.map((warning, i) => (
            <p key={i} className="break-all py-1">
              {warning}
            </p>
          ))}
        </details>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {diff.items.length ? (
            <StyledDiffCodeView
              key={expandedPath}
              viewerRef={diff.viewer}
              className="h-full overflow-auto [scrollbar-gutter:stable]"
              items={diff.items}
              options={diff.options}
              renderHeaderPrefix={diff.header}
              renderHeaderFilenameSuffix={diff.suffix}
            />
          ) : (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              {!snapshot
                ? "Loading repositories and worktrees…"
                : !snapshot.checkouts.length
                  ? "No Git repositories found in this directory."
                  : visible.length
                    ? "Select a workspace to view changes."
                    : "No local changes in the selected checkouts."}
            </p>
          )}
        </div>
        {treeOpen ? (
          <ResizableFilesSidebar width={treeWidth} onWidthChange={setTreeWidth}>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto" aria-label="Changed files">
              {visible.map((checkout) => (
                <details
                  key={checkout.path}
                  open={expandedPath === checkout.path}
                  className="border-b last:border-0"
                >
                  <summary
                    className="cursor-pointer px-3 py-2 text-sm"
                    onClick={(event) => {
                      event.preventDefault();
                      setExpandedPath((previous) =>
                        previous === checkout.path ? null : checkout.path,
                      );
                    }}
                  >
                    <strong>{checkout.repository}</strong> · {checkout.branch}{" "}
                    <span className="text-muted-foreground">
                      ({checkout.changes.length}){checkout.current ? " · Current" : ""}
                    </span>
                  </summary>
                  <p className="break-all px-3 pb-2 text-xs text-muted-foreground">
                    {checkout.path}
                  </p>
                  {checkout.error ? (
                    <p role="alert" className="px-3 pb-2 text-xs text-destructive">
                      {checkout.error}
                    </p>
                  ) : null}
                  <ChangeTree
                    changes={checkout.changes}
                    ariaLabel={`${checkout.repository} · ${checkout.branch} · ${checkout.path}`}
                    selectedPath={active?.checkout === checkout.path ? active.path : null}
                    onSelectFile={(path) => diff.reveal(checkout.path, path)}
                  />
                </details>
              ))}
            </div>
          </ResizableFilesSidebar>
        ) : null}
      </div>
    </div>
  );
}
