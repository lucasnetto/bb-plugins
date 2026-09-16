import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import type { LinkedDetail } from "../../shared/links-contract";

// Keep successful and in-flight requests across panel unmounts. Bound the cache
// because PR details include patches; Refresh explicitly replaces the entry.
const details = new Map<string, { value?: LinkedDetail; request: Promise<LinkedDetail> }>();

const cacheKey = (threadId: string | null, url: string) => JSON.stringify([threadId, url]);

export function useReviewData(threadId: string | null, url: string, refreshRevision = 0) {
  const rpc = useRpc<typeof rpcContract>();
  const key = cacheKey(threadId, url);
  const [detail, setDetail] = useState<LinkedDetail | null>(() => details.get(key)?.value ?? null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!details.get(key)?.value);
  const [revision, setRevision] = useState(0);
  const [requestRevision, setRequestRevision] = useState(0);
  const currentDetail = useRef(detail);
  const refreshing = useRef(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const previousRefreshRevision = useRef(0);
  useEffect(() => {
    if (previousRefreshRevision.current !== refreshRevision) {
      details.delete(key);
      previousRefreshRevision.current = refreshRevision;
    }
    let disposed = false;
    let entry = details.get(key);

    if (!entry) {
      const request = threadId
        ? rpc.call("linkedDetail", { threadId, url })
        : rpc.call("reviewDraftDetail", { url });

      entry = { request };
      const created = entry;
      details.set(key, entry);

      if (details.size > 20) details.delete(details.keys().next().value!);
      void request.then(
        (value) => {
          created.value = value;
        },
        () => {
          if (details.get(key) === created) details.delete(key);
        },
      );
    }

    setLoading(!currentDetail.current);
    refreshing.current = true;
    setError("");
    entry.request
      .then(
        (value) => {
          if (disposed) return;
          const previous = currentDetail.current;

          if (JSON.stringify(previous) !== JSON.stringify(value)) {
            currentDetail.current = value;
            setDetail(value);

            if (
              previous &&
              (previous.headRefOid !== value.headRefOid || previous.baseRefOid !== value.baseRefOid)
            )
              setRevision((current) => current + 1);
          }

          setSelectedPath((current) =>
            value.files.some((f) => f.path === current) ? current : (value.files[0]?.path ?? null),
          );
        },
        (error) => {
          if (!disposed) setError(String(error));
        },
      )
      .finally(() => {
        if (!disposed) {
          setLoading(false);
          refreshing.current = false;
        }
      });

    return () => {
      disposed = true;
    };
  }, [rpc, threadId, url, key, requestRevision, refreshRevision]);

  const refresh = useCallback(() => {
    if (refreshing.current) return;
    details.delete(key);
    setRequestRevision((value) => value + 1);
  }, [key]);

  useEffect(() => {
    const background = () => {
      if (document.visibilityState !== "hidden") refresh();
    };

    window.addEventListener("focus", background);
    document.addEventListener("visibilitychange", background);
    const timer = window.setInterval(background, 60000);

    return () => {
      window.removeEventListener("focus", background);
      document.removeEventListener("visibilitychange", background);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return {
    detail,
    error,
    setError,
    loading,
    revision,
    refresh,
    selectedPath,
    setSelectedPath,
  };
}
