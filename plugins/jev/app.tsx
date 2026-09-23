import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useRealtimeConnectionState,
  useBbNavigate,
  experimental_useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadPanelProps, PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./src/contract";
import { fixtures, fixtureId, type Result, type FixtureId } from "./src/domain";
import { createRowBridge } from "./src/bridge";

type Snapshot = {
  issue: string | null;
  enabled: boolean;
  fixtureMode: boolean;
  liveEnabled: boolean;
  requireZdr: boolean;
  keyConfigured: boolean;
  requestsToday: number;
  dailyRequestLimit: number;
  eligibleThreadIds: string[];
  results: Result[];
};

const button =
  "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 disabled:opacity-50";

function useResults(threadId?: string) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serial = useRef(0);
  const active = useRef(false);

  const refetch = useCallback(() => {
    const ticket = ++serial.current;

    if (connection !== "connected") {
      setData(null);

      return;
    }

    rpc.call("list", threadId ? { threadId } : {}).then(
      (value) => {
        if (active.current && ticket === serial.current) {
          setData(value);
          setError(null);
        }
      },
      () => {
        if (active.current && ticket === serial.current) {
          setError("Unable to load Jev results. Reconnecting will refresh them.");
          setData(null);
        }
      },
    );
  }, [rpc, threadId, connection]);

  useEffect(() => {
    active.current = true;
    refetch();
    const timer = setInterval(refetch, 5000);

    return () => {
      active.current = false;
      serial.current++;
      clearInterval(timer);
    };
  }, [refetch]);
  useRealtime("attention-changed", refetch);

  return { rpc, data, error, refetch, setError };
}

function labelFor(result: Result) {
  if (result.verdict.execution === "error") return "Check failed";

  if (result.verdict.execution === "timeout") return "Check timed out";

  return (
    result.verdict.label?.replaceAll("_", " ") ??
    (result.verdict.execution === "skipped" ? "Not classified" : "No attention label")
  );
}

function AttentionPage({ threadId }: { threadId?: string }) {
  const { rpc, data, error, refetch, setError } = useResults(threadId);
  const navigate = useBbNavigate();
  const [selected, setSelected] = useState<FixtureId>("decision");
  const [pending, setPending] = useState(false);

  async function replay() {
    setPending(true);

    try {
      await rpc.call("replay", threadId ? { fixture: selected, threadId } : { fixture: selected });
      refetch();
    } catch {
      setError(
        "Could not queue the fixture. Enable fixture mode and, for a thread preview, select its project in Jev settings and wait until it is idle.",
      );
    } finally {
      setPending(false);
    }
  }

  async function checkLive() {
    setPending(true);

    try {
      if (threadId) await rpc.call("check", { threadId });
      else await rpc.call("checkFixture", { fixture: selected });
      refetch();
    } catch {
      setError(
        "Could not queue Jev. Enable live checks and configure a key in Settings → Jev. Thread checks require the approved project and an idle thread.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-muted-foreground">Read-only attention · Jev</p>
        <p className="text-sm">
          Review evidence before acting. Fixture results demonstrate the integration; they do not
          assess your conversation or measure Jev accuracy. Live checks use the retention policy
          shown below.
        </p>
        {!data?.enabled && (
          <p role="status" className="rounded-md border border-border p-3">
            Enable attention in Settings → Jev. Enable fixture mode for offline demos or live checks
            for Gateway evaluation.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`jev-fixture-${threadId ?? "page"}`} className="text-sm">
            Fixture
          </label>
          <select
            id={`jev-fixture-${threadId ?? "page"}`}
            className="rounded-md border border-border bg-background p-2 text-sm"
            value={selected}
            onChange={(e) => setSelected(fixtureId.parse(e.target.value))}
          >
            {fixtureId.options.map((id) => (
              <option key={id} value={id}>
                {fixtures[id].title}
              </option>
            ))}
          </select>
          <button
            className={button}
            disabled={!data?.enabled || !data.fixtureMode || pending}
            onClick={() => void replay()}
          >
            {threadId ? "Preview fixture on this thread" : "Run fixture"}
          </button>
        </div>
        <button
          className={button}
          disabled={!data?.enabled || !data.liveEnabled || !data.keyConfigured || pending}
          onClick={() => void checkLive()}
        >
          {threadId ? "Check this thread with Jev" : "Test selected fixture through Gateway"}
        </button>
        {data?.liveEnabled && (
          <p className="text-xs text-muted-foreground">
            Gateway requests today: {data.requestsToday} / {data.dailyRequestLimit}.{" "}
            {data.requireZdr
              ? "Zero data retention required."
              : "Zero data retention not required."}{" "}
            {data.keyConfigured ? "Server key configured." : "Server key needed."}
          </p>
        )}
        {threadId && (
          <p className="text-xs text-muted-foreground">
            A preview uses only the selected synthetic text and clears when the thread changes. It
            requires the approved project and an idle thread.
          </p>
        )}
        {data?.issue && (
          <p role="status" className="text-sm text-muted-foreground">
            {data.issue}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {data && data.results.length === 0 && (
          <p
            role="status"
            className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground"
          >
            No results yet. Queued checks appear here when complete.
          </p>
        )}
        {data?.results.map((result) => (
          <article
            key={result.id}
            className="space-y-3 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{labelFor(result)}</h2>
              <span className="text-xs text-muted-foreground">
                {result.verdict.model === "typesafe-ai/jev"
                  ? result.packet.fixture
                    ? "Synthetic Gateway check"
                    : "Live Gateway check"
                  : result.packet.fixture
                    ? "Fixture preview"
                    : "Captured locally"}{" "}
                · {!result.current ? "Superseded" : (result.annotation ?? "Current")}
              </span>
            </div>
            <p className="text-sm">{result.verdict.uncertainty}</p>
            <details>
              <summary className="cursor-pointer text-sm">Evidence and revision</summary>
              <div className="mt-3 space-y-3">
                <p className="break-all text-xs text-muted-foreground">
                  Revision {result.packet.revision} · {result.packet.coverage} coverage ·{" "}
                  {result.packet.omitted} events omitted · external usage{" "}
                  {result.verdict.usage ?? "unknown"}
                  {result.verdict.usage !== null ? " tokens" : ""}
                </p>
                {result.verdict.metrics && (
                  <p className="text-xs text-muted-foreground">
                    {result.verdict.metrics.latencyMs} ms ·{" "}
                    {result.verdict.metrics.zeroDataRetention ? "ZDR required" : "ZDR not required"}{" "}
                    · model {result.verdict.metrics.requestedModel}.
                    {result.verdict.metrics.probabilities && (
                      <>
                        {" "}
                        Choice probabilities:{" "}
                        {Object.entries(result.verdict.metrics.probabilities)
                          .map(
                            ([label, value]) =>
                              `${label.replaceAll("_", " ")}: ${Math.round(value * 100)}%`,
                          )
                          .join(", ")}
                        . These are not calibrated accuracy estimates.
                      </>
                    )}
                  </p>
                )}
                {result.packet.evidence.map((e) => (
                  <blockquote key={e.id} className="border-l-2 border-border pl-3">
                    <p className="whitespace-pre-wrap break-words text-sm">{e.text}</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {e.kind === "fixture" ? "Synthetic source" : "Original event"}: {e.sourceId} ·
                      sequence {e.sequence}
                      {e.truncated ? " · excerpt truncated" : ""}
                    </p>
                  </blockquote>
                ))}
                {result.packet.threadId && (
                  <button
                    className={button}
                    onClick={() => navigate.toThread(result.packet.threadId!)}
                  >
                    Open thread
                  </button>
                )}
                <p className="text-xs text-muted-foreground">
                  Exact event scrolling is unavailable through the installed public API. Use the
                  source ID and excerpt to locate the evidence.
                </p>
              </div>
            </details>
            <div className="flex gap-2">
              {(["dismissed", "incorrect"] as const).map((annotation) => (
                <button
                  className={button}
                  key={annotation}
                  disabled={!result.current || result.annotation !== null}
                  onClick={() => {
                    rpc
                      .call("annotate", {
                        id: result.id,
                        revision: result.packet.revision,
                        annotation,
                      })
                      .then(refetch, () =>
                        setError("The result changed; refresh before correcting it."),
                      );
                  }}
                >
                  {annotation === "dismissed" ? "Dismiss" : "Mark incorrect"}
                </button>
              ))}
            </div>
          </article>
        ))}
        <p className="text-xs text-muted-foreground">
          T3 sidebar users can inspect attention here or in the Jev thread panel. Native runtime,
          permission, queue, and draft indicators keep their own presentation.
        </p>
        <button
          className={button}
          onClick={() => {
            rpc.call("clear").then(refetch, () => setError("Could not clear Jev data."));
          }}
        >
          Clear Jev evidence and results
        </button>
      </div>
    </div>
  );
}

function ThreadPanel({ threadId }: PluginThreadPanelProps) {
  return <AttentionPage threadId={threadId} />;
}

function Header({ threadId }: PluginThreadHeaderActionProps) {
  const { data } = useResults(threadId);
  const navigate = useBbNavigate();
  const current = data?.results.find((r) => r.current && !r.annotation && r.verdict.label);

  return (
    <button
      className={button}
      title={
        current
          ? `${current.packet.fixture ? "Fixture preview" : "Jev"}: ${labelFor(current)}`
          : "Open Jev evidence"
      }
      onClick={() => {
        if (!navigate.openThreadPanel({ actionId: "evidence" }))
          navigate.toPluginPanel("attention");
      }}
    >
      Jev{current ? " · attention" : ""}
    </button>
  );
}

export default definePluginApp((app) => {
  const bridge = createRowBridge();

  function Sync() {
    const { data } = useResults();
    const sidebar = experimental_useSidebarThreads();
    useEffect(() => {
      bridge.update(
        data?.results ?? [],
        sidebar.status === "ready" ? sidebar.threads : [],
        data?.eligibleThreadIds ?? [],
      );

      return () => bridge.reset();
    }, [data, sidebar]);

    return null;
  }

  app.contentScripts.register({
    id: "attention-status",
    mount: (context) => bridge.mount(context),
  });
  app.slots.experimental_appOverlay({ id: "attention-sync", component: Sync });
  app.slots.navPanel({
    id: "attention",
    title: "Jev Attention",
    icon: "Eye",
    path: "attention",
    component: () => <AttentionPage />,
  });
  app.slots.threadPanelAction({
    id: "evidence",
    title: "Jev evidence",
    icon: "Eye",
    component: ThreadPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "jev",
    title: "Jev attention",
    component: Header,
  });
});
