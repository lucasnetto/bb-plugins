import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  ThreadChat,
  useRpc,
  useRealtime,
  useRealtimeConnectionState,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { PAGE_SIZE, WORKERS_CHANGED } from "./events";
import type { Worker, rpcContract } from "./contract";

const button =
  "rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed";

const workerChangedSchema = z.object({ threadId: z.string() });

const statusLabels = new Map([
  ["active", "Working"],
  ["idle", "Idle"],
  ["error", "Failed"],
  ["starting", "Starting"],
  ["pending", "Queued"],
  ["stopping", "Stopping"],
  ["provisioning", "Preparing"],
  ["host-reconnecting", "Reconnecting"],
  ["waiting-for-host", "Waiting for host"],
]);

export function WorkersPanel({ threadId }: PluginThreadPanelProps) {
  // Reset selection and pending requests when the host reuses this panel for another parent.
  return <WorkerBrowser key={threadId} threadId={threadId} />;
}

function WorkerBrowser({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useRealtime(WORKERS_CHANGED, (payload) => {
    const event = workerChangedSchema.safeParse(payload);

    if (event.success && event.data.threadId === threadId) refresh();
  });
  useEffect(() => {
    // Covers renames, visibility changes, and interaction resolutions without lifecycle events.
    const timer = setInterval(refresh, 10000);

    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    let disposed = false;
    rpc.call("list", { threadId, offset }).then(
      (result) => {
        if (disposed) return;
        setWorkers(result.workers);
        setSelectedId((current) =>
          result.workers.some((worker) => worker.id === current)
            ? current
            : (result.workers[0]?.id ?? null),
        );
        setHasMore(result.hasMore);
        setError("");
        setLoading(false);
      },
      (cause: unknown) => {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : "Could not load workers.");
        setLoading(false);
      },
    );

    return () => {
      disposed = true;
    };
  }, [rpc, threadId, offset, revision, connection]);

  const selected = workers.find((worker) => worker.id === selectedId);

  function changePage(nextOffset: number) {
    setOffset(nextOffset);
    setWorkers([]);
    setSelectedId(null);
    setLoading(true);
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      aria-label="Workers"
    >
      <header className="shrink-0 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <select
            aria-label="Select worker"
            value={selected?.id ?? ""}
            disabled={!workers.length}
            onChange={(event) => {
              setSelectedId(event.target.value);
            }}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {!workers.length ? (
              <option value="">{loading ? "Loading workers…" : "No workers yet"}</option>
            ) : null}
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.title} · {worker.model ?? worker.providerId} ·{" "}
                {worker.hasPendingInteraction
                  ? "Needs input"
                  : (statusLabels.get(worker.status) ?? worker.status)}
              </option>
            ))}
          </select>
        </div>
        {selected ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p
              className="min-w-0 truncate text-xs text-muted-foreground"
              title={[selected.model ?? selected.providerId, selected.reasoningLevel]
                .filter(Boolean)
                .join(" · ")}
            >
              {[selected.model ?? selected.providerId, selected.reasoningLevel]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ) : null}
        {workers.some((worker) => worker.hasPendingInteraction) ? (
          <p className="mt-2 text-xs text-destructive" role="status">
            {workers.filter((worker) => worker.hasPendingInteraction).length} workers need input
          </p>
        ) : null}
      </header>
      {error ? (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {offset > 0 || hasMore ? (
        <nav
          aria-label="Worker pages"
          className="flex shrink-0 justify-between border-t border-border p-2"
        >
          <button
            type="button"
            className={button}
            disabled={offset === 0 || loading}
            onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            type="button"
            className={button}
            disabled={!hasMore || loading}
            onClick={() => changePage(offset + PAGE_SIZE)}
          >
            Next
          </button>
        </nav>
      ) : null}
      {selected ? (
        <>
          <div className="min-h-0 flex-1" aria-label="Worker conversation">
            <ThreadChat
              key={selected.id}
              threadId={selected.id}
              variant="compact"
              layout="contained"
              permissionPolicy="inherit"
              className="h-full"
            />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border p-6 text-center text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">
              {loading ? "Loading workers…" : workers.length ? "Select a worker" : "No workers yet"}
            </p>
            <p className="mt-2 max-w-xs">
              {workers.length
                ? "Read its conversation or send a follow-up here."
                : "Child threads appear here automatically, including hidden and archived workers."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
