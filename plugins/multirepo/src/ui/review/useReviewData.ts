import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import type { LinkedDetail } from "../../shared/links-contract";

export function useReviewData(threadId: string, url: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [detail, setDetail] = useState<LinkedDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    rpc
      .call("linkedDetail", { threadId, url })
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
  }, [rpc, threadId, url, revision]);

  return {
    detail,
    error,
    setError,
    loading,
    revision,
    refresh: () => setRevision((value) => value + 1),
    selectedPath,
    setSelectedPath,
  };
}
