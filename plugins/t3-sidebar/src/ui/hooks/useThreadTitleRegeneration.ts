import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "@/shared/rpc-contract";

export function useThreadTitleRegeneration(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [available, setAvailable] = useState(false);
  const [running, setRunning] = useState(false);
  const observedRunning = useRef(false);
  const startPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await rpc.call("rename_status", { threadId });

      if (!mounted.current || startPending.current) return;
      setAvailable(result.available);
      const active = result.job?.status === "running";
      setRunning(active);

      if (observedRunning.current && !active) {
        if (result.job?.status === "renamed") toast.success(`Renamed to “${result.job.title}”`);
        else if (result.job?.status === "failed")
          toast.error(result.job.message ?? "Could not regenerate title");
        else toast.info(result.job?.message ?? "Title generation stopped. Try again.");
      }

      observedRunning.current = active;
    } catch {
      if (!mounted.current) return;

      if (observedRunning.current)
        toast.error("Could not check title generation. Reopen the menu to retry.");
      observedRunning.current = false;
      setRunning(false);
      setAvailable(false);
    }
  }, [rpc, threadId]);

  useEffect(() => {
    if (!running) return;

    const timer = setInterval(() => {
      void refresh();
    }, 1000);

    return () => clearInterval(timer);
  }, [running, refresh]);

  const start = useCallback(async () => {
    if (startPending.current || running) return;
    startPending.current = true;
    setRunning(true);

    try {
      await rpc.call("rename_start", { threadId });
      observedRunning.current = true;
    } catch {
      if (mounted.current) {
        setRunning(false);
        toast.error("Could not start title generation");
      }
    } finally {
      startPending.current = false;
    }
  }, [rpc, threadId, running]);

  return { available, running, start, refresh };
}
