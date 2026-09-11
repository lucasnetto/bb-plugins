import { listenForPrLinks, listenForReviewRequests } from "./lib/review-navigation";
import { PrReview } from "./review/PrReview";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import {
  useRpc,
  useRealtime,
  useRealtimeConnectionState,
  useBbNavigate,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import type { rpcContract } from "../shared/contract";
import type { LinkedPr } from "../shared/links-contract";
import { LINKS_CHANGED } from "../shared/links-events";
import { overviewCache, workspaceKey } from "./workspace/workspace-cache";

function LinkedPrReview({ threadId, url }: { threadId: string; url: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [ready, setReady] = useState(() => !!overviewCache.peek(workspaceKey(threadId, url)));
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    async function prepare() {
      const links = await rpc.call("linkedList", { threadId });
      if (disposed) return;
      if (!links.some((link) => link.url === url)) {
        await rpc.call("linkedLink", { threadId, url, reason: "manual" });
      }
      if (!disposed) setReady(true);
    }
    void prepare().catch((reason) => {
      if (!disposed) setError(String(reason));
    });
    return () => {
      disposed = true;
    };
  }, [rpc, threadId, url]);
  if (error)
    return (
      <p role="alert" className="p-4">
        {error}
      </p>
    );
  if (!ready) return <p className="p-4 text-sm text-muted-foreground">Opening pull request…</p>;
  return <PrReview threadId={threadId} url={url} />;
}

export function LinkedPrsPanel({ threadId, params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const connection = useRealtimeConnectionState();
  const [links, setLinks] = useState<LinkedPr[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    let disposed = false;
    setError("");
    rpc.call("linkedList", { threadId }).then(
      (result) => {
        if (!disposed) setLinks(result);
      },
      (e) => {
        if (!disposed) setError(String(e));
      },
    );
    return () => {
      disposed = true;
    };
  }, [rpc, threadId, connection, revision]);
  useRealtime(LINKS_CHANGED, (payload) => {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "threadId" in payload &&
      payload.threadId === threadId
    )
      reload();
  });
  const selectedUrl =
    typeof params === "object" &&
    params !== null &&
    !Array.isArray(params) &&
    typeof params.url === "string"
      ? params.url
      : null;
  async function link() {
    setPending(true);
    setError("");
    try {
      await rpc.call("linkedLink", { threadId, url, reason: "manual" });
      setUrl("");
      reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  async function unlink(pr: LinkedPr) {
    setError("");
    try {
      await rpc.call("linkedUnlink", { threadId, url: pr.url });
      reload();
    } catch (e) {
      setError(String(e));
    }
  }
  function openReview(event: MouseEvent<HTMLAnchorElement>, pr: LinkedPr) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate.openThreadPanel({
      actionId: "linked-prs",
      title: `${pr.repository} #${pr.number}`,
      params: { url: pr.url },
    });
  }
  if (selectedUrl)
    return (
      <LinkedPrReview key={`${threadId}:${selectedUrl}`} threadId={threadId} url={selectedUrl} />
    );
  return (
    <section
      className="flex h-full flex-col gap-4 overflow-auto p-4"
      aria-label="Linked pull requests"
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void link();
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label className="text-sm font-medium" htmlFor={`pr-url-${threadId}`}>
            Pull request URL
          </label>
          <Input
            id={`pr-url-${threadId}`}
            placeholder="https://github.com/owner/repo/pull/123"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending || !url.trim()}>
          {pending ? "Linking…" : "Link PR"}
        </Button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {!links.length ? (
        <p className="text-sm text-muted-foreground">
          No linked PRs. Paste a URL or ask your agent to link one.
        </p>
      ) : null}
      {links.map((pr) => (
        <div
          key={pr.url}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3"
        >
          <div className="min-w-0">
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium hover:underline focus-visible:underline"
              onClick={(event) => openReview(event, pr)}
            >
              {pr.title}
            </a>
            <p className="text-xs text-muted-foreground">
              {pr.repository} #{pr.number} · {pr.state} · {pr.reason}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => openReview(event, pr)}
              >
                Review
              </a>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void unlink(pr)}>
              Unlink
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

// The separate sidebar reads the public link endpoint. Relay invalidations from
// BB's plugin-scoped realtime hook without touching BB's DOM or private state.
export function LinkedPrHeader({ threadId }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  useEffect(
    () =>
      listenForPrLinks(({ url, title }) =>
        navigate.openThreadPanel({ actionId: "linked-prs", title, params: { url } }),
      ),
    [threadId, navigate],
  );
  useEffect(
    () =>
      listenForReviewRequests(threadId, ({ url, title }) => {
        navigate.openThreadPanel({ actionId: "linked-prs", title, params: { url } });
      }),
    [threadId, navigate],
  );
  useRealtime(LINKS_CHANGED, () => window.dispatchEvent(new Event("bb:pr-review:links-changed")));
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => navigate.openThreadPanel({ actionId: "linked-prs" })}
    >
      Linked PRs
    </Button>
  );
}
