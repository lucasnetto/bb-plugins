import { useEffect, useState } from "react";
import { useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import { guideWorkerId, type GuideJob, type GuideModel } from "../../shared/guide-generation";

export function useGuideGeneration(
  threadId: string,
  url: string,
  revision: number,
  refresh: () => void,
  blocked: boolean,
) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [job, setJob] = useState<GuideJob | null>(null);
  const [operation, setOperation] = useState<"starting" | "cancelling" | null>(null);
  const [error, setError] = useState("");
  const generating = job?.status === "running" || job?.status === "preparing";
  useEffect(() => {
    let disposed = false;
    const load = () =>
      rpc.call("guideJob", { threadId, url }).then(
        (value) => {
          if (!disposed) {
            setError("");
            setJob((current) =>
              current?.id === value?.id &&
              current?.status === value?.status &&
              (current?.status === "error" ? current.error : "") ===
                (value?.status === "error" ? value.error : "") &&
              (current ? guideWorkerId(current) : null) === (value ? guideWorkerId(value) : null)
                ? current
                : value,
            );
          }
        },
        (error) => {
          if (!disposed) setError(String(error));
        },
      );
    void load();
    const timer = generating ? setInterval(() => void load(), 3000) : undefined;
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [rpc, threadId, url, revision, connection, generating]);
  async function start(model: GuideModel) {
    if (blocked || operation !== null) return false;
    setOperation("starting");
    setError("");
    try {
      setJob(await rpc.call("guideStart", { threadId, url, model }));
      return true;
    } catch (error) {
      setError(String(error));
      return false;
    } finally {
      setOperation(null);
    }
  }
  async function cancel() {
    if (blocked || operation !== null) return;
    setOperation("cancelling");
    try {
      await rpc.call("guideCancel", { threadId, url });
      refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setOperation(null);
    }
  }
  return {
    generating,
    starting: operation === "starting",
    cancelling: operation === "cancelling",
    error: error || (job?.status === "error" ? job.error : ""),
    start,
    cancel,
  };
}
