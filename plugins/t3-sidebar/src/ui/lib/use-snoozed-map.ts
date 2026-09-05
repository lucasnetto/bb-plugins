import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../shared/rpc-contract";
import { SNOOZED_CHANGED, type SnoozedMap } from "../../shared/snooze-contract";

export function useSnoozedMap() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [snoozed, setSnoozed] = useState<SnoozedMap>({});
  const generation = useRef(0);
  const refetch = useCallback(() => {
    const request = ++generation.current;
    void rpc.call("snoozed_list").then(
      (result) => {
        if (request === generation.current) setSnoozed(result.snoozed);
      },
      (cause: unknown) => console.warn("[t3-sidebar] snoozed_list failed", cause),
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
    window.addEventListener("focus", refetch);
    return () => {
      ++generation.current;
      window.removeEventListener("focus", refetch);
    };
  }, [refetch, connection]);
  useRealtime(SNOOZED_CHANGED, refetch);
  const set = useCallback(
    (threadId: string, until: number | null) => {
      void rpc.call("snoozed_set", { threadId, until }).then(
        () => refetch(),
        (cause: unknown) => {
          toast.error(until === null ? "Could not wake thread" : "Could not snooze thread", {
            description: cause instanceof Error ? cause.message : undefined,
          });
          refetch();
        },
      );
    },
    [rpc, refetch],
  );
  return { snoozed, set };
}
