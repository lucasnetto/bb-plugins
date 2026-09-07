import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import {
  LIST_CHANGED,
  type ListSnapshot,
  type rpcContract,
  type View,
  type PrState,
} from "./contract";

export function useList(view: View, state: PrState) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [snapshot, setSnapshot] = useState<ListSnapshot>();
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const active = useRef(false);
  const sequence = useRef(0);
  const refreshingRef = useRef(false);
  const read = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const data = await rpc.call("savedList", { view, state });
      if (active.current && sequence.current === request) setSnapshot(data);
    } catch (reason) {
      if (active.current && sequence.current === request) setError(String(reason));
    }
  }, [rpc, view, state]);
  const refresh = useCallback(
    async (force = false, loadMore = false) => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      setRefreshing(true);
      setError("");
      try {
        await rpc.call("refreshList", { view, state, force, loadMore });
        if (active.current) await read();
      } catch (reason) {
        if (active.current) setError(String(reason));
      } finally {
        refreshingRef.current = false;
        if (active.current) setRefreshing(false);
      }
    },
    [rpc, view, state, read],
  );
  useRealtime(LIST_CHANGED, (payload) => {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "view" in payload &&
      payload.view === view &&
      (!snapshot || ("scope" in payload && payload.scope === snapshot.scope))
    )
      void read();
  });
  useEffect(() => {
    active.current = true;
    // Avoid flashing a full-page loader for a fast SQLite round trip.
    const timer = setTimeout(() => setShowLoading(true), 150);
    return () => {
      active.current = false;
      sequence.current++;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    void read();
    if (connection === "connected") void refresh();
  }, [read, refresh, connection]);
  return {
    result: snapshot?.result ?? null,
    fetchedAt: snapshot?.fetchedAt,
    error: error || snapshot?.error || "",
    loading: refreshing || !snapshot,
    showLoading: showLoading && !snapshot?.result,
    refresh,
  };
}
