import { useEffect, useState } from "react";
import { useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import type { SavedGuide } from "../../shared/guide-contract";

export function useSavedGuide(
  threadId: string | null,
  url: string,
  revision: number,
  refreshRevision: number,
  refresh: () => void,
) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<SavedGuide | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProgress, setSavingProgress] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!threadId) {
      setLoading(false);

      return;
    }

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
  }, [rpc, threadId, url, connection, refreshRevision, revision]);

  async function mark(chapter: number, reviewed: boolean) {
    if (!threadId || !data || savingProgress) return;
    setSavingProgress(true);
    setError("");

    try {
      await rpc.call("guideProgress", { threadId, url, id: data.id, chapter, reviewed });
      refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setSavingProgress(false);
    }
  }

  return { data, loading, savingProgress, error, mark };
}
