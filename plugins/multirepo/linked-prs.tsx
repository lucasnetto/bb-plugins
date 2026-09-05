import { PrReview } from "./review/PrReview";
import { useCallback, useEffect, useState } from "react";
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
import type { rpcContract } from "./contract";
import type { LinkedPr } from "./links-contract";
import { LINKS_CHANGED } from "./links-events";

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
  if (selectedUrl)
    return <PrReview key={`${threadId}:${selectedUrl}`} threadId={threadId} url={selectedUrl} />;
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
            <p className="text-sm font-medium">{pr.title}</p>
            <p className="text-xs text-muted-foreground">
              {pr.repository} #{pr.number} · {pr.state} · {pr.reason}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigate.openThreadPanel({
                  actionId: "linked-prs",
                  title: `${pr.repository} #${pr.number}`,
                  params: { url: pr.url },
                })
              }
            >
              Review
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
  useEffect(() => {
    const key = `bb:multirepo:open-review:${threadId}`;
    const open = () => {
      const url = sessionStorage.getItem(key);
      if (!url) return;
      sessionStorage.removeItem(key);
      const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)$/.exec(url);
      if (match)
        navigate.openThreadPanel({
          actionId: "linked-prs",
          title: `${match[1]} #${match[2]}`,
          params: { url },
        });
    };
    open();
    window.addEventListener("bb:multirepo:open-review", open);
    return () => window.removeEventListener("bb:multirepo:open-review", open);
  }, [threadId, navigate]);
  useRealtime(LINKS_CHANGED, () => window.dispatchEvent(new Event("bb:multirepo:links-changed")));
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
