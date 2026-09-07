import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, SettledMap } from "@/shared/rpc-contract";
import { SETTLED_CHANGED } from "@/shared/contract";

/** The plugin-owned settled map, kept current by the server's realtime signal. */
export function useSettledMap() {
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
