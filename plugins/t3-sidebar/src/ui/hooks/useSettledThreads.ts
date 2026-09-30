import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreadActions,
  type PluginSidebarThread,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "@/shared/rpc-contract";
import type { SettledThread } from "@/shared/settled-contract";
import { SETTLED_CHANGED } from "@/shared/contract";

import { mergeSettledHistory } from "@/ui/lib/settled-history";

type OptimisticSettlement = {
  thread: PluginSidebarThread;
  confirmed: boolean;
};

export function useSettledThreads(liveThreads: readonly PluginSidebarThread[]) {
  const rpc = useRpc<typeof rpcContract>();
  const actions = experimental_useSidebarThreadActions();
  const [archivedThreads, setArchivedThreads] = useState<SettledThread[]>([]);
  const revision = useRef(0);
  const [optimistic, setOptimistic] = useState<Record<string, OptimisticSettlement>>({});
  const requests = useRef(new Map<string, Promise<unknown>>());

  const authoritative = useMemo(
    () => mergeSettledHistory(liveThreads, archivedThreads),
    [liveThreads, archivedThreads],
  );

  const threads = useMemo(() => {
    const rows = new Map(authoritative.map((thread) => [thread.id, thread]));

    for (const [id, update] of Object.entries(optimistic)) rows.set(id, update.thread);

    return [...rows.values()];
  }, [authoritative, optimistic]);

  useEffect(() => {
    setOptimistic((current) => {
      const next = { ...current };

      for (const [id, update] of Object.entries(current)) {
        if (
          update.confirmed &&
          authoritative.some(
            (thread) => thread.id === id && thread.isArchived === update.thread.isArchived,
          )
        )
          delete next[id];
      }

      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [authoritative, optimistic]);

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
      if (settled) {
        // The host owns child confirmation and Undo. Do not move the card
        // until its archive has actually been confirmed by the user.
        actions.archive(threadId);

        return;
      }

      const thread = threads.find((row) => row.id === threadId);

      const update = thread
        ? {
            thread: {
              ...thread,
              isArchived: settled,
              archivedAt: null,
            },
            confirmed: false,
          }
        : undefined;

      if (update) setOptimistic((current) => ({ ...current, [threadId]: update }));
      // Serialize repeated Un-settle clicks while the previous request finishes.
      const previous = requests.current.get(threadId) ?? Promise.resolve();

      const request = previous
        .catch(() => {})
        .then(() => rpc.call("settled_set", { threadId, settled }));

      requests.current.set(threadId, request);
      void request.then(
        () => {
          if (requests.current.get(threadId) !== request) return;
          requests.current.delete(threadId);
          setOptimistic((current) =>
            current[threadId] === update && update
              ? { ...current, [threadId]: { ...update, confirmed: true } }
              : current,
          );
          refetch();
        },
        (cause: unknown) => {
          if (requests.current.get(threadId) !== request) return;
          requests.current.delete(threadId);
          setOptimistic((current) => {
            const next = { ...current };
            delete next[threadId];

            return next;
          });
          toast.error(settled ? "Could not settle thread" : "Could not un-settle thread");
          console.warn("[t3-sidebar] settled_set failed", cause);
          refetch();
        },
      );
    },
    [actions, rpc, refetch, threads],
  );

  return { archivedThreads, threads, set, refetch };
}
