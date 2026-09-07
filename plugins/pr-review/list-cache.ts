import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  hostContract,
  LIST_CHANGED,
  snapshotSchema,
  workspaceSchema,
  type ListSnapshot,
  type ListResult,
  type PullRequest,
  type View,
  type PrState,
} from "./contract";

export function createListCache(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE list_snapshots (scope TEXT PRIMARY KEY, data TEXT NOT NULL)",
  ]);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const controller = new AbortController();
  // Share only in-flight work. All completed list data is stored in SQLite.
  const pending = new Map<string, Promise<null>>();
  bb.onDispose(async () => {
    controller.abort();
    await Promise.allSettled(pending.values());
  });
  const workspace = () =>
    bb.sdk.plugins.callRpc({
      pluginId: "multirepo",
      method: "workspace",
      input: null,
      outputSchema: workspaceSchema,
    });
  const scopeOf = (
    w: { projectId: string; hostId: string; root: string },
    view: View,
    state: PrState,
  ) => JSON.stringify(["open-prs-v2", w.projectId, w.hostId, w.root, view, state]);
  function read(scope: string, view: View): ListSnapshot {
    const row = db.prepare("SELECT data FROM list_snapshots WHERE scope = ?").get(scope);
    if (!row) return { scope, view, result: null, fetchedAt: null, pageCount: 0, error: null };
    const parsed = snapshotSchema.safeParse(
      JSON.parse(z.object({ data: z.string() }).parse(row).data),
    );
    if (!parsed.success) throw new Error("Invalid saved pull request list");
    return parsed.data;
  }
  function save(snapshot: ListSnapshot) {
    controller.signal.throwIfAborted();
    db.prepare("INSERT OR REPLACE INTO list_snapshots (scope, data) VALUES (?, ?)").run(
      snapshot.scope,
      JSON.stringify(snapshot),
    );
    bb.realtime.publish(LIST_CHANGED, { scope: snapshot.scope, view: snapshot.view });
  }
  return {
    savedList: async ({ view, state = "all" }: { view: View; state?: PrState }) =>
      read(scopeOf(await workspace(), view, state), view),
    refreshList: async ({
      view,
      state = "all",
      force,
      loadMore,
    }: {
      view: View;
      state?: PrState;
      force: boolean;
      loadMore: boolean;
    }) => {
      const w = await workspace();
      const scope = scopeOf(w, view, state);
      const running = pending.get(scope);
      if (running) return running;
      const saved = read(scope, view);
      if (!force && !loadMore && saved.fetchedAt !== null && Date.now() - saved.fetchedAt < 60_000)
        return null;
      const refresh = async (): Promise<null> => {
        try {
          const pages = Math.min(20, Math.max(1, saved.pageCount + (loadMore ? 1 : 0)));
          let combined: ListResult | null = null;
          let pageCount = 0;
          const rows = new Map<string, PullRequest>();
          let incomplete = false;
          let viewer: string | undefined;
          for (let page = 1; page <= pages; page++) {
            const data = await host.call(
              "list",
              { root: w.root, view, state, page },
              {
                hostId: w.hostId,
                signal: controller.signal,
              },
            );
            // Never combine pages fetched under different GitHub accounts.
            if (viewer && data.viewer !== viewer)
              throw new Error("GitHub account changed during refresh. Please retry.");
            viewer = data.viewer;
            for (const pr of data.rows) rows.set(pr.url, pr);
            incomplete ||= data.incomplete;
            combined = { ...data, rows: [...rows.values()], incomplete };
            pageCount = page;
            if (!data.nextPage) break;
          }
          save({ scope, view, result: combined, fetchedAt: Date.now(), pageCount, error: null });
        } catch (error) {
          if (controller.signal.aborted) throw error;
          save({ ...saved, error: error instanceof Error ? error.message : String(error) });
        }
        return null;
      };
      const task = refresh().finally(() => pending.delete(scope));
      pending.set(scope, task);
      return task;
    },
  };
}
