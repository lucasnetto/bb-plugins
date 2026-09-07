import { useEffect, useRef } from "react";
import type { SettledMap } from "@/shared/rpc-contract";

export function useSettledReconciliation(
  staleSettledIds: readonly string[],
  settledAt: SettledMap,
  setSettled: (ids: readonly string[], value: boolean) => void,
) {
  // A settled thread that woke up must lose its entry, or it would silently
  // re-settle the moment it goes quiet. Cleared once per id per wake.
  const clearedStaleRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = staleSettledIds.filter((id) => !clearedStaleRef.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) clearedStaleRef.current.add(id);
    setSettled(fresh, false);
  }, [staleSettledIds, setSettled]);
  useEffect(() => {
    for (const id of clearedStaleRef.current) {
      if (!(id in settledAt)) clearedStaleRef.current.delete(id);
    }
  }, [settledAt]);
}
