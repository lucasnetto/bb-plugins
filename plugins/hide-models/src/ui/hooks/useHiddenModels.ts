import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import {
  HIDDEN_CHANGED,
  type CatalogProvider,
  type HiddenModel,
  type rpcContract,
} from "../../shared/contract";
import { writeCache } from "../lib/hidden-model-cache";

export function useHiddenModels() {
  const rpc = useRpc<typeof rpcContract>();
  const [catalog, setCatalog] = useState<CatalogProvider[] | null>(null);
  const [hidden, setHidden] = useState<HiddenModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lifecycle = useRef<{
    hiddenRequest: number;
    catalogRequest: number;
    pendingSaves: number;
    refetchPending: boolean;
  } | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const refetchHidden = useCallback(() => {
    const current = lifecycle.current;
    if (!current) return;
    // Realtime publishes before hidden_set responds. Read only after every
    // pending write settles so that it cannot replace an optimistic update.
    if (current.pendingSaves > 0) {
      current.refetchPending = true;
      return;
    }
    current.refetchPending = false;
    const request = ++current.hiddenRequest;
    const isCurrent = () => lifecycle.current === current && request === current.hiddenRequest;
    rpc.call("hidden_get").then(
      (result) => {
        if (!isCurrent()) return;
        setHidden(result.hidden);
        writeCache(result.hidden);
        setError(null);
      },
      (cause) => {
        if (isCurrent()) report(cause);
      },
    );
  }, [rpc, report]);

  const refetchCatalog = useCallback(() => {
    const current = lifecycle.current;
    if (!current) return;
    const request = ++current.catalogRequest;
    const isCurrent = () => lifecycle.current === current && request === current.catalogRequest;
    setCatalog(null);
    rpc.call("catalog").then(
      (result) => {
        if (!isCurrent()) return;
        setCatalog(result.providers);
        setError(null);
      },
      (cause) => {
        if (isCurrent()) report(cause);
      },
    );
  }, [rpc, report]);

  useEffect(() => {
    // A fresh identity also rejects work from Strict Mode's first setup.
    lifecycle.current = {
      hiddenRequest: 0,
      catalogRequest: 0,
      pendingSaves: 0,
      refetchPending: false,
    };
    refetchHidden();
    refetchCatalog();
    return () => {
      lifecycle.current = null;
    };
  }, [refetchHidden, refetchCatalog]);
  useRealtime(HIDDEN_CHANGED, refetchHidden);

  const save = useCallback(
    (next: HiddenModel[]) => {
      const current = lifecycle.current;
      if (!current) return;
      const request = ++current.hiddenRequest;
      current.pendingSaves++;
      const isCurrent = () => lifecycle.current === current && request === current.hiddenRequest;
      setHidden(next);
      writeCache(next);
      rpc
        .call("hidden_set", { hidden: next })
        .then(
          (result) => {
            if (!isCurrent()) return;
            setHidden(result.hidden);
            writeCache(result.hidden);
            setError(null);
          },
          (cause) => {
            if (isCurrent()) report(cause);
          },
        )
        .finally(() => {
          current.pendingSaves--;
          if (
            lifecycle.current === current &&
            current.pendingSaves === 0 &&
            current.refetchPending
          ) {
            refetchHidden();
          }
        });
    },
    [rpc, report, refetchHidden],
  );

  return { catalog, hidden, error, save, refetchCatalog };
}
