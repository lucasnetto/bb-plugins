import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import { LIST_CHANGED } from "../../../contract";
import { toast } from "sonner";
import type {
  workspaceRpcContract,
  Overview,
  PrStack,
  WorkspaceAction,
} from "../../shared/workspace-contract";

export function useWorkspaceData(threadId: string | null, url: string, active: boolean) {
  const rpc = useRpc<typeof workspaceRpcContract>();
  const [detail, setDetail] = useState<Overview | null>(null);
  const [stack, setStack] = useState<PrStack | null>(null);
  const [stackLoaded, setStackLoaded] = useState(false);
  const [stackError, setStackError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const refreshing = useRef(false);
  const writing = useRef(false);
  const pendingKey = `pr-review:merge:v1:${url}`;
  const [pending, setPending] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(pendingKey);
    } catch {
      return null;
    }
  });
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    await Promise.allSettled([
      rpc.call("prOverview", { threadId, url }).then(
        (value) => {
          if (mounted.current) {
            setDetail(value);
            setError("");
          }
        },
        (reason) => {
          if (mounted.current) setError(String(reason));
        },
      ),
      rpc.call("prStack", { threadId, url }).then(
        (value) => {
          if (mounted.current) {
            setStack(value);
            setStackLoaded(true);
            setStackError("");
          }
        },
        (reason) => {
          if (mounted.current) {
            setStackLoaded(false);
            setStackError(String(reason));
          }
        },
      ),
    ]);
    refreshing.current = false;
    if (mounted.current) setLoading(false);
  }, [rpc, threadId, url]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!active) return;
    const background = () => {
      if (document.visibilityState !== "hidden" && !writing.current) void refresh();
    };
    background();
    window.addEventListener("focus", background);
    const timer = window.setInterval(background, 60000);
    return () => {
      window.removeEventListener("focus", background);
      window.clearInterval(timer);
    };
  }, [active, refresh]);
  useRealtime(LIST_CHANGED, (payload) => {
    if (
      active &&
      !writing.current &&
      payload &&
      typeof payload === "object" &&
      "mutation" in payload
    )
      void refresh();
  });
  useEffect(() => {
    if (!pending || !active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await rpc.call("prMergeStatus", { threadId, url, id: pending });
        if (disposed) return;
        if (result.status === "pending") timer = setTimeout(() => void poll(), 5000);
        else {
          setPending(null);
          try {
            sessionStorage.removeItem(pendingKey);
          } catch {
            /* The live state is authoritative. */
          }
          if (result.status === "failed")
            setError(result.details.message ?? "GitHub refused the stack merge.");
          else
            toast.success(
              result.status === "enqueued" ? "Stack added to the merge queue." : "Stack merged.",
            );
          setRevision((value) => value + 1);
          void refresh();
        }
      } catch (reason) {
        if (disposed) return;
        setError(
          `Cannot read the merge status. The request may still be running on GitHub. ${String(reason)}`,
        );
        timer = setTimeout(() => void poll(), 15000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [rpc, pending, active, threadId, url, pendingKey, refresh]);
  async function mutate(action: WorkspaceAction, expected?: { head: string; base: string }) {
    if (!detail || writing.current || pending) return false;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await rpc.call("prAction", {
        threadId,
        url,
        head: expected?.head ?? detail.headRefOid,
        base: expected?.base ?? detail.baseRefName,
        action,
      });
      if (result.pendingMergeId) {
        try {
          sessionStorage.setItem(pendingKey, result.pendingMergeId);
        } catch {
          /* Polling still continues in this pane. */
        }
        if (mounted.current) setPending(result.pendingMergeId);
      }
      if (!mounted.current) return true;
      toast.success(result.message);
      setRevision((value) => value + 1);
      await refresh();
      return true;
    } catch (reason) {
      if (mounted.current) setError(String(reason));
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    detail,
    stack,
    stackLoaded,
    stackError,
    error,
    setError,
    loading,
    busy: busy || !!pending,
    pending,
    refresh,
    mutate,
    revision,
  };
}
export type WorkspaceData = ReturnType<typeof useWorkspaceData>;
