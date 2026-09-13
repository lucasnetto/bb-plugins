import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import { LIST_CHANGED, listMutationEvent } from "../../../contract";
import { toast } from "sonner";
import { invalidateWorkspace, overviewCache, stackCache, workspaceKey } from "./workspace-cache";
import type { workspaceRpcContract, WorkspaceAction } from "../../shared/workspace-contract";

export function useWorkspaceData(threadId: string | null, url: string, active: boolean) {
  const rpc = useRpc<typeof workspaceRpcContract>();
  const key = workspaceKey(threadId, url);
  const [detail, setDetail] = useState(() => overviewCache.peek(key) ?? null);
  const [stack, setStack] = useState(() => stackCache.peek(key) ?? null);
  const [stackLoaded, setStackLoaded] = useState(() => stackCache.peek(key) !== undefined);
  const [stackError, setStackError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const generation = useRef(0);
  const writing = useRef(false);
  const pendingKey = `pr-review:merge:v1:${url}`;

  const [pending, setPending] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(pendingKey);
    } catch {
      return null;
    }
  });

  const load = useCallback(
    async (force: boolean) => {
      const current = ++generation.current;
      const alive = () => mounted.current && current === generation.current;
      setLoading(true);
      await Promise.allSettled([
        overviewCache
          .read(key, () => rpc.call("prOverview", { threadId, url }), force)
          .then(
            (value) => {
              if (alive()) {
                setDetail(value);
                setError("");
              }
            },
            (reason) => {
              if (alive()) setError(String(reason));
            },
          ),
        stackCache
          .read(key, () => rpc.call("prStack", { threadId, url }), force)
          .then(
            (value) => {
              if (alive()) {
                setStack(value);
                setStackLoaded(true);
                setStackError("");
              }
            },
            (reason) => {
              if (alive()) {
                setStackLoaded(false);
                setStackError(String(reason));
              }
            },
          ),
      ]);

      if (alive()) setLoading(false);
    },
    [rpc, threadId, url, key],
  );

  const refresh = useCallback(() => load(true), [load]);
  useEffect(() => {
    mounted.current = true;
    void load(false);

    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!active) return;

    const background = () => {
      if (document.visibilityState !== "hidden" && !writing.current) void load(false);
    };

    background();
    window.addEventListener("focus", background);
    const timer = window.setInterval(background, 60000);

    return () => {
      window.removeEventListener("focus", background);
      window.clearInterval(timer);
    };
  }, [active, load]);
  useRealtime(LIST_CHANGED, (payload) => {
    if (listMutationEvent.safeParse(payload).success) {
      invalidateWorkspace();

      if (active && !writing.current) void refresh();
    }
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
          invalidateWorkspace();
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

      invalidateWorkspace();

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
