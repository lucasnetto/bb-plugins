import { useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { rpcContract } from "../../shared/contract";
import { LINKS_CHANGED } from "../../shared/links-events";
import { Button } from "../components/ui/button";

const changeEvent = z.object({ threadId: z.string() });

export function usePrLink(threadId: string, url: string) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const mutating = useRef(false);
  const refresh = () => setRevision((value) => value + 1);
  useRealtime(LINKS_CHANGED, (payload) => {
    const event = changeEvent.safeParse(payload);

    if (event.success && event.data.threadId === threadId) refresh();
  });

  useEffect(() => {
    const version = ++request.current;

    if (mutating.current) return;
    void rpc.call("linkedList", { threadId }).then(
      (links) => {
        if (version !== request.current) return;
        setLinked(links.some((link) => link.url === url));
        setError("");
      },
      (reason) => {
        if (version === request.current) setError(String(reason));
      },
    );

    return () => {
      request.current++;
    };
  }, [rpc, threadId, url, connection, revision]);

  async function toggle() {
    if (linked === null || mutating.current) return;
    mutating.current = true;
    request.current++;
    setPending(true);
    setError("");

    try {
      if (linked) await rpc.call("linkedUnlink", { threadId, url });
      else await rpc.call("linkedLink", { threadId, url, reason: "manual" });
      setLinked(!linked);
      refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      mutating.current = false;
      setPending(false);
    }
  }

  return { linked, pending, error, toggle, refresh };
}

export function PrLinkButton({ link }: { link: ReturnType<typeof usePrLink> }) {
  return (
    <>
      {link.error && (
        <span role="alert" className="text-xs text-destructive">
          {link.error}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={link.pending || (link.linked === null && !link.error)}
        onClick={() => (link.linked === null ? link.refresh() : void link.toggle())}
      >
        {link.linked === null && link.error
          ? "Retry link status"
          : link.pending
            ? link.linked
              ? "Unlinking…"
              : "Linking…"
            : link.linked
              ? "Unlink PR"
              : "Link PR"}
      </Button>
    </>
  );
}
