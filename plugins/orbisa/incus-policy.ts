import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const INCUS_DELETE_GRACE_MS = 10 * 60_000;
const stateSchema = z.object({ settledAt: z.number().finite(), deleteAt: z.number().finite() });
const stateKey = (hostId: string) => `incus-retirement/${hostId}`;

// Settled is BB's archived state, not an agent becoming idle after a turn.
export function createIncusPolicy(
  bb: BbPluginApi,
  owned: (resource: unknown) => { key: string },
  now = Date.now,
) {
  let pending = Promise.resolve();
  let disposed = false;

  async function read(hostId: string) {
    const value = await bb.storage.kv.get(stateKey(hostId));
    return value == null ? null : stateSchema.parse(value);
  }

  async function threads(archived: boolean) {
    const result: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];
    for (let offset = 0; ; offset += 100) {
      const page = await bb.sdk.threads.list({ archived, includeHidden: true, limit: 100, offset });
      result.push(
        ...page.filter((t) => t.deletedAt === null && (t.archivedAt !== null) === archived),
      );
      if (page.length < 100) return result;
    }
  }

  async function sweep() {
    const hosts = (await bb.sdk.hosts.list({ includeCreating: true })).filter(
      (host) =>
        host.machineProviderId === "orbisa-incus" &&
        ["active", "suspended"].includes(host.lifecycle.phase),
    );
    if (!hosts.length || disposed) return;
    const live = await threads(false);
    // An unattached launch may be about to acquire an existing environment.
    // Core also checks launches/setup atomically when accepting suspension.
    const starting = (rows: typeof live) =>
      rows.some((t) => t.status === "starting" && t.environmentId === null);
    if (starting(live)) return;
    const archived = await threads(true);

    for (const host of hosts) {
      if (disposed) return;
      try {
        const resource = owned(await bb.experimental_machines.getResource(host.id));
        const environments = new Set(
          (await bb.sdk.environments.list({ hostId: host.id })).map((e) => e.id),
        );
        const belongs = (t: (typeof live)[number]) =>
          t.id === resource.key || (t.environmentId !== null && environments.has(t.environmentId));
        let state = await read(host.id);
        if (live.some(belongs)) {
          if (state) await bb.storage.kv.set(stateKey(host.id), null);
          continue;
        }

        // The archive timestamp recovers a notification missed during a server
        // restart. A newer settlement starts a full new grace period, including
        // rapid unarchive/rearchive actions that coalesce before this sweep.
        const retired = archived.filter(belongs);
        if (retired.length) {
          const settledAt = Math.max(...retired.map((t) => t.archivedAt!));
          if (!state || settledAt > state.settledAt) {
            state = { settledAt, deleteAt: settledAt + INCUS_DELETE_GRACE_MS };
            await bb.storage.kv.set(stateKey(host.id), state);
          }
        }
        // Standalone machines without archived ownership have no deadline.
        // A saved deadline still applies if the archived thread is later deleted.
        if (!state) continue;

        const fresh = await threads(false);
        if (disposed) return;
        // A new environment may have attached to this machine during the reads.
        for (const e of await bb.sdk.environments.list({ hostId: host.id })) environments.add(e.id);
        if (fresh.some(belongs)) {
          await bb.storage.kv.set(stateKey(host.id), null);
          continue;
        }
        if (starting(fresh)) continue;
        // Recheck settlement too: an unarchive/rearchive can occur while the
        // ownership reads are in flight and must receive a new full window.
        const latestArchived = (await threads(true)).filter(belongs);
        if (latestArchived.length) {
          const settledAt = Math.max(...latestArchived.map((t) => t.archivedAt!));
          if (settledAt > state.settledAt) {
            state = { settledAt, deleteAt: settledAt + INCUS_DELETE_GRACE_MS };
            await bb.storage.kv.set(stateKey(host.id), state);
          }
        }
        const current = await bb.sdk.hosts.get({ hostId: host.id });
        if (disposed) return;
        if (!["active", "suspended"].includes(current.lifecycle.phase)) continue;
        if (now() >= state.deleteAt) {
          // Core checks live ownership again, journals teardown and retries it.
          // Settling authorizes removal of all files, including dirty Git work.
          await bb.sdk.hosts.delete({ hostId: host.id });
          continue;
        }
        if (current.lifecycle.phase !== "active") continue;
        // Use BB's lifecycle coordinator; it drains runtimes and terminals and
        // preserves enrollment. Calling the CLI directly would bypass wakeup.
        await bb.sdk.hosts.experimental_suspend({ hostId: host.id });
      } catch {
        bb.log.warn(`Orbisa archive cleanup deferred for ${host.id}; retrying next minute.`);
      }
    }
  }

  function reconcile() {
    const next = pending.then(async () => {
      if (!disposed) await sweep();
    });
    pending = next.catch(() => {});
    return next;
  }

  bb.events.on("thread.archived", reconcile);
  bb.events.on("thread.unarchived", reconcile);
  bb.events.on("thread.deleted", reconcile);
  bb.background.schedule("incus-archive-cleanup", "* * * * *", reconcile);
  bb.background.service("incus-archive-recovery", { start: reconcile });
  bb.onDispose(async () => {
    disposed = true;
    await pending;
  });
  return { reconcile, read };
}
