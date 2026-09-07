import { useCallback, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "@/shared/rpc-contract";
import type { SettledThread } from "@/shared/settled-contract";
import { SETTLED_CHANGED } from "@/shared/contract";

export function useSettledThreads() {
  const rpc = useRpc<typeof rpcContract>();
  const [archivedThreads, setArchivedThreads] = useState<SettledThread[]>([]);
  const revision = useRef(0);
  const refetch = useCallback(() => {
    const request = ++revision.current;
    rpc.call("settled_list").then(
      (result) => {
        if (request === revision.current) setArchivedThreads(result.archivedThreads);
      },
      (cause: unknown) => {
        console.warn("[t3-sidebar] settled_list failed", cause);
        toast.error("Could not load settled threads");
      },
    );
  }, [rpc]);
  useRealtime(SETTLED_CHANGED, refetch);
  const set = useCallback(
    (threadId: string, settled: boolean) => {
      rpc.call("settled_set", { threadId, settled }).then(refetch, (cause: unknown) => {
        toast.error(settled ? "Could not settle thread" : "Could not un-settle thread");
        console.warn("[t3-sidebar] settled_set failed", cause);
        refetch();
      });
    },
    [rpc, refetch],
  );
  return { archivedThreads, set, refetch };
}
