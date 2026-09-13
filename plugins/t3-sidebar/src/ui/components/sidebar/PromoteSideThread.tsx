import { Match } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBbNavigate,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "@/shared/rpc-contract";
import { SIDE_THREAD_CHANGED } from "@/shared/side-thread-contract";
import { Button } from "@/ui/components/ui/button";
import { Icon } from "@/ui/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/components/ui/tooltip";

export function PromoteSideThread() {
  const { scope } = useComposerView();

  // BB's embedded ThreadChat uses a thread scope. Also support the native
  // side-chat scope, whose child does not exist until its first submission.
  const threadId = Match.value(scope).pipe(
    Match.when({ kind: "thread" }, (scope) => scope.threadId),
    Match.when({ kind: "side-chat" }, (scope) => scope.childThreadId),
    Match.orElse(() => null),
  );

  return threadId ? <PromoteButton key={threadId} threadId={threadId} /> : null;
}

function PromoteButton({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const connection = useRealtimeConnectionState();
  const [canPromote, setCanPromote] = useState(false);
  const [pending, setPending] = useState(false);
  const promoting = useRef(false);
  const revision = useRef(0);

  const refetch = useCallback(() => {
    if (promoting.current) return;
    const request = ++revision.current;
    rpc.call("side_thread_status", { threadId }).then(
      (result) => {
        if (request === revision.current) setCanPromote(result.canPromote);
      },
      (cause: unknown) => {
        if (request !== revision.current) return;
        setCanPromote(false);
        console.warn("[t3-sidebar] side_thread_status failed", cause);
      },
    );
  }, [rpc, threadId]);

  useEffect(() => {
    refetch();

    return () => {
      revision.current += 1;
    };
  }, [refetch, connection]);
  useRealtime(SIDE_THREAD_CHANGED, refetch);

  async function promote() {
    if (promoting.current) return;
    promoting.current = true;
    revision.current += 1;
    setPending(true);

    try {
      const result = await rpc.call("side_thread_promote", { threadId });
      setCanPromote(false);
      toast.success("Thread added to sidebar");
      navigate.toThread(result.threadId);
    } catch (cause) {
      toast.error("Could not promote side thread");
      console.warn("[t3-sidebar] side_thread_promote failed", cause);
    } finally {
      promoting.current = false;
      setPending(false);
    }
  }

  if (!canPromote) return null;
  const label = pending ? "Promoting…" : "Promote to sidebar";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label={label}
            aria-busy={pending}
            disabled={pending}
            onClick={() => void promote()}
          >
            {pending ? (
              <Icon name="Spinner" className="motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Icon name="ArrowUpRight" aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
