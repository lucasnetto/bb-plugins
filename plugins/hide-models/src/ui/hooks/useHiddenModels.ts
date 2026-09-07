import { useCallback, useEffect, useState } from "react";
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
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const refetchHidden = useCallback(() => {
    rpc.call("hidden_get").then((result) => {
      setHidden(result.hidden);
      writeCache(result.hidden);
      setError(null);
    }, report);
  }, [rpc, report]);

  const refetchCatalog = useCallback(() => {
    setCatalog(null);
    rpc.call("catalog").then((result) => {
      setCatalog(result.providers);
      setError(null);
    }, report);
  }, [rpc, report]);

  useEffect(() => {
    refetchHidden();
    refetchCatalog();
  }, [refetchHidden, refetchCatalog]);
  useRealtime(HIDDEN_CHANGED, refetchHidden);

  const save = useCallback(
    (next: HiddenModel[]) => {
      setHidden(next);
      writeCache(next);
      rpc.call("hidden_set", { hidden: next }).then((result) => {
        setHidden(result.hidden);
        writeCache(result.hidden);
      }, report);
    },
    [rpc, report],
  );

  return { catalog, hidden, error, save, refetchCatalog };
}
