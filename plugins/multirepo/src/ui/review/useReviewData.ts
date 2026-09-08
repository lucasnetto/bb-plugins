import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import type { LinkedDetail } from "../../shared/links-contract";

// Keep successful and in-flight requests across panel unmounts. Bound the cache
// because PR details include patches; Refresh explicitly replaces the entry.
const details = new Map<string, { value?: LinkedDetail; request: Promise<LinkedDetail> }>();
const cacheKey = (threadId: string, url: string) => JSON.stringify([threadId, url]);

export function useReviewData(threadId: string, url: string) {
  const rpc = useRpc<typeof rpcContract>();
  const key = cacheKey(threadId, url);
  const [detail, setDetail] = useState<LinkedDetail | null>(() => details.get(key)?.value ?? null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!details.get(key)?.value);
  const [revision, setRevision] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let entry = details.get(key);
    if (!entry) {
      const request = rpc.call("linkedDetail", { threadId, url });
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
    setLoading(!entry.value);
    setError("");
    entry.request
      .then(
        (value) => {
          if (disposed) return;
          setDetail(value);
          setSelectedPath((current) =>
            value.files.some((f) => f.path === current) ? current : (value.files[0]?.path ?? null),
          );
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
  }, [rpc, threadId, url, key, revision]);

  return {
    detail,
    error,
    setError,
    loading,
    revision,
    refresh: () => {
      details.delete(key);
      setRevision((value) => value + 1);
    },
    selectedPath,
    setSelectedPath,
  };
}
