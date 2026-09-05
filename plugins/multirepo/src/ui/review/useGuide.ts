import type { GuideJob, GuideModel } from "../../shared/guide-generation";
import { useEffect, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import { GUIDE_CHANGED, type SavedGuide } from "../../shared/guide-contract";

export function useGuide(threadId: string, url: string, revision: number) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<SavedGuide | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<GuideJob | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const generating = job?.status === "running" || job?.status === "preparing";
  useEffect(() => {
    let disposed = false;
    const load = () =>
      rpc.call("guideJob", { threadId, url }).then(
        (value) => {
          if (!disposed)
            setJob((current) =>
              current?.id === value?.id &&
              current?.status === value?.status &&
              current?.error === value?.error &&
              current?.workerId === value?.workerId
                ? current
                : value,
            );
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
  }, [rpc, threadId, url, refresh, connection, generating]);
  useRealtime(GUIDE_CHANGED, (payload) => {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "threadId" in payload &&
      payload.threadId === threadId &&
      "url" in payload &&
      payload.url === url
    )
      setRefresh((value) => value + 1);
  });
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    rpc
      .call("guideGet", { threadId, url })
      .then(
        (value) => {
          if (!disposed) {
            setData(value);
            setError("");
          }
        },
        (error) => {
          if (!disposed) setError(String(error));
        },
      )
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [rpc, threadId, url, connection, refresh, revision]);
  async function start(model: GuideModel) {
    setPending(true);
    setError("");
    try {
      setJob(await rpc.call("guideStart", { threadId, url, model }));
      setRequestOpen(false);
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    setPending(true);
    try {
      await rpc.call("guideCancel", { threadId, url });
      setRefresh((value) => value + 1);
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  }
  async function mark(chapter: number, reviewed: boolean) {
    if (!data || pending) return;
    setPending(true);
    setError("");
    try {
      await rpc.call("guideProgress", { threadId, url, id: data.id, chapter, reviewed });
      setRefresh((value) => value + 1);
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  }
  return {
    data,
    loading,
    pending,
    error: error || (job?.status === "error" ? job.error : ""),
    request: () => setRequestOpen(true),
    requestOpen,
    setRequestOpen,
    generating,
    start,
    cancel,
    mark,
  };
}
