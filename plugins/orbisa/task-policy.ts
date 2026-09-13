import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { TASK_PROVIDER, ownedResource, resourceSchema, type TaskResource } from "./task-vms.ts";

export const DELETE_GRACE_MS = 10 * 60_000;

const policySchema = z.object({
  lastActivity: z.number().finite(),
  deleteAt: z.number().finite().nullable(),
});

export type TaskPolicyState = z.infer<typeof policySchema>;

const policyKey = (hostId: string) => `task-policy/${hostId}`;

type Host = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["get"]>>;

export function createTaskPolicy(
  bb: BbPluginApi,
  owner: string,
  idleMinutes: () => Promise<number>,
  now = Date.now,
) {
  // Serialize events, settings sweeps and startup reconciliation. A slow SDK
  // call cannot overwrite a later activity event with an older deadline.
  let pending = Promise.resolve();
  let disposed = false;

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(() => {
      if (disposed) throw new Error("Orbisa task policy stopped.");

      return operation();
    });

    pending = next.then(
      () => {},
      () => {},
    );

    return next;
  }

  async function read(hostId: string): Promise<TaskPolicyState | null> {
    const value = await bb.storage.kv.get(policyKey(hostId));

    return value === undefined ? null : policySchema.parse(value);
  }

  async function activity(hostId: string) {
    const host = await bb.sdk.hosts.get({ hostId });

    if (host.machineProviderId !== TASK_PROVIDER || host.lifecycle.phase === "destroyed") return;
    const state = await read(hostId);
    await bb.storage.kv.set(policyKey(hostId), {
      lastActivity: now(),
      deleteAt: state?.deleteAt ?? null,
    });
  }

  // The count API excludes hidden threads and cannot opt them in. Ownership
  // needs actual thread/environment identities, including hidden workers and
  // launches that have not attached yet, so page the public list explicitly.
  async function liveThreads() {
    const result: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];

    for (let offset = 0; ; offset += 100) {
      const page = await bb.sdk.threads.list({
        archived: false,
        includeHidden: true,
        limit: 100,
        offset,
      });

      result.push(
        ...page.filter((thread) => thread.archivedAt === null && thread.deletedAt === null),
      );

      if (page.length < 100) return result;
    }
  }

  async function owners(
    host: Pick<Host, "id">,
    resource: TaskResource,
    threads: Awaited<ReturnType<typeof liveThreads>>,
  ) {
    const environments = new Set(
      (await bb.sdk.environments.list({ hostId: host.id })).map((environment) => environment.id),
    );

    return threads.filter(
      (thread) =>
        thread.id === resource.key ||
        (thread.environmentId !== null && environments.has(thread.environmentId)),
    );
  }

  async function sweep() {
    const hosts = (await bb.sdk.hosts.list({ includeCreating: true })).filter(
      (host) => host.machineProviderId === TASK_PROVIDER,
    );

    if (!hosts.length) return;
    const idleMs = (await idleMinutes()) * 60_000;
    // Pending launches may not have an environment/host attachment yet. Hold
    // retirement during any starting thread rather than infer missing ownership.
    const threads = await liveThreads();
    const starting = threads.some((thread) => thread.status === "starting");

    for (const host of hosts) {
      if (disposed) return;

      if (!["active", "suspended"].includes(host.lifecycle.phase)) continue;

      try {
        const resource = ownedResource(
          owner,
          resourceSchema.parse(await bb.experimental_machines.getResource(host.id)),
        );

        let state = (await read(host.id)) ?? { lastActivity: now(), deleteAt: null };
        const owned = await owners(host, resource, threads);
        const live = owned.length > 0;

        if (live) {
          const busy =
            owned.some((thread) => thread.status === "active" || thread.status === "stopping") ||
            starting;

          state = { lastActivity: busy ? now() : state.lastActivity, deleteAt: null };
        } else if (!starting && state.deleteAt === null) {
          state = { ...state, deleteAt: now() + DELETE_GRACE_MS };
        }

        await bb.storage.kv.set(policyKey(host.id), state);

        if (!live && !starting && state.deleteAt !== null && state.deleteAt <= now()) {
          // BB atomically refuses removal when another live thread acquired the
          // machine after our observation. It owns cleanup progress and retries.
          const fresh = await liveThreads();

          if (
            !fresh.some((thread) => thread.status === "starting") &&
            (await owners(host, resource, fresh)).length === 0
          ) {
            await bb.sdk.hosts.delete({ hostId: host.id });
          }

          continue;
        }

        if (
          idleMs > 0 &&
          !starting &&
          host.lifecycle.phase === "active" &&
          now() >= state.lastActivity + idleMs
        ) {
          await bb.sdk.hosts.experimental_suspend({ hostId: host.id });
        }
      } catch {
        // Failed observations preserve state. Retry on the next sweep; never
        // expose transport errors that might contain credential-bearing output.
        bb.log.warn(`Orbisa task lifecycle deferred for ${host.id}; inspect its machine status.`);
      }
    }
  }

  const reconcile = () => serialize(sweep);
  const bump = (hostId: string) => serialize(() => activity(hostId));

  const onThreadActivity: Parameters<
    typeof bb.events.on<"experimental_thread.events">
  >[1] = async ({ thread }) => {
    if (thread.status !== "starting" && thread.status !== "active") return;

    if (thread.environmentId) {
      const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
      await bump(environment.hostId);
    }
  };

  bb.events.on("experimental_thread.events", onThreadActivity);
  bb.events.on("experimental_terminal.input", ({ terminal }) => bump(terminal.hostId));

  for (const event of ["thread.archived", "thread.unarchived", "thread.deleted"] as const) {
    bb.events.on(event, reconcile);
  }

  bb.background.schedule("task-machine-lifecycle", "* * * * *", reconcile);
  bb.background.service("task-machine-recovery", {
    async start() {
      await reconcile();
    },
  });
  bb.onDispose(async () => {
    disposed = true;
    await pending;
  });

  return { reconcile, bump, read };
}
