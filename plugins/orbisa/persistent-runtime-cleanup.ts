import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Semaphore } from "effect";
import { foreign } from "./persistent-effects.ts";
import { PERSISTENT_PROVIDER } from "./persistent-resource.ts";

type Thread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];

const busy = (thread: Thread) =>
  thread.status !== "idle" ||
  thread.queuedWork !== "none" ||
  thread.hasPendingInteraction ||
  Object.values(thread.activity).some((count) => count > 0);

// A dispatch that has passed our hook gets a fresh idle deadline. Dispatches
// arriving during cleanup wait in BB's queue until the runtime has been released.
export function createPersistentRuntimeCleanup(
  bb: BbPluginApi,
  idleMinutes: () => Promise<number>,
  now = Date.now,
  cleanProcesses: (
    hostId: string,
    paths: string[],
    threadIds: string[],
    signal: AbortSignal,
  ) => Promise<void> = async () => {},
) {
  const startedAt = now();
  const cleaning = new Set<string>();
  const dispatching = new Set<string>();
  const lock = Semaphore.makeUnsafe(1);
  const activityKey = (id: string) => `runtime-cleanup/activity/${id}`;
  const cleanedKey = (id: string) => `runtime-cleanup/cleaned/${id}`;

  bb.experimental_hooks.on("message.dispatch", async ({ host }) => {
    if (host?.machineProviderId !== PERSISTENT_PROVIDER) return { action: "proceed" };

    if (cleaning.has(host.id))
      return { action: "wait", reason: "Releasing idle agent runtimes; work will start shortly." };
    dispatching.add(host.id);

    try {
      await bb.storage.kv.delete(cleanedKey(host.id));
      await bb.storage.kv.set(activityKey(host.id), now());
    } finally {
      dispatching.delete(host.id);
    }

    return { action: "proceed" };
  });

  const listThreads = async (signal: AbortSignal) => {
    const threads: Thread[] = [];

    for (let offset = 0; ; offset += 100) {
      const page = await bb.sdk.threads.list({ includeHidden: true, limit: 100, offset, signal });
      threads.push(...page);

      if (page.length < 100) return threads;
    }
  };

  const clean = async (hostId: string, minutes: number, signal: AbortSignal) => {
    cleaning.add(hostId);

    try {
      if (dispatching.has(hostId)) return;
      const activity = await bb.storage.kv.get<number>(activityKey(hostId));
      const cleaned = await bb.storage.kv.get<number>(cleanedKey(hostId));
      const since = Math.max(startedAt, activity ?? startedAt);

      if (!Number.isFinite(since) || now() - since < minutes * 60_000) return;

      const threads = (await listThreads(signal)).filter(
        (thread) => thread.environmentHostId === hostId,
      );

      if (threads.some(busy)) return;

      if (threads.some((thread) => now() - thread.updatedAt < minutes * 60_000)) return;

      // Host-path scope includes the machine's terminals, regardless of thread.
      const terminals = await bb.sdk.terminals.list({
        scope: { kind: "host_path", hostId },
        signal,
      });

      const openTerminals = terminals.sessions.filter((terminal) => terminal.status !== "exited");

      const lastInput = Math.max(
        0,
        ...openTerminals.map((terminal) => terminal.lastUserInputAt ?? terminal.createdAt),
      );

      if (now() - lastInput < minutes * 60_000) return;

      if (cleaned !== undefined && cleaned >= Math.max(since, lastInput)) return;

      const currentBeforeClose = (await listThreads(signal)).filter(
        (thread) => thread.environmentHostId === hostId,
      );

      if (currentBeforeClose.some(busy)) return;

      for (const terminal of openTerminals) {
        signal.throwIfAborted();

        const latest = await bb.sdk.terminals.list({
          scope: { kind: "host_path", hostId },
          signal,
        });

        if (
          latest.sessions.some(
            (item) =>
              item.status !== "exited" &&
              now() - (item.lastUserInputAt ?? item.createdAt) < minutes * 60_000,
          )
        )
          return;
        await bb.sdk.terminals.close({ terminalId: terminal.id, mode: "force" });
      }

      for (const candidate of threads) {
        // Re-read activity immediately before each release. The dispatch hook
        // holds new messages, and active/background work keeps the machine intact.
        const current = (await listThreads(signal)).filter(
          (thread) => thread.environmentHostId === hostId,
        );

        if (current.some(busy)) return;

        if (!current.some((thread) => thread.id === candidate.id && thread.status === "idle"))
          continue;
        signal.throwIfAborted();
        await bb.sdk.threads.stop({ threadId: candidate.id });
      }

      const beforeProcesses = (await listThreads(signal)).filter(
        (thread) => thread.environmentHostId === hostId,
      );

      if (beforeProcesses.some(busy)) return;

      const finalTerminals = await bb.sdk.terminals.list({
        scope: { kind: "host_path", hostId },
        signal,
      });

      if (finalTerminals.sessions.some((terminal) => terminal.status !== "exited")) return;
      const environments = await bb.sdk.environments.list({ hostId, signal });

      const paths = [
        ...new Set(
          environments.flatMap((environment) => (environment.path ? [environment.path] : [])),
        ),
      ];

      signal.throwIfAborted();
      await cleanProcesses(
        hostId,
        paths,
        beforeProcesses.map((thread) => thread.id),
        signal,
      );
      signal.throwIfAborted();
      await bb.storage.kv.set(cleanedKey(hostId), now());

      if (threads.length)
        bb.log.info(
          `Released idle runtimes for ${threads.length} threads on ${hostId}; machine remains connected.`,
        );
    } finally {
      cleaning.delete(hostId);

      if (!signal.aborted) await bb.experimental_hooks.recheck("message.dispatch");
    }
  };

  const sweep = Effect.fn("Persistent.cleanupIdleRuntimes")(function* () {
    const minutes = yield* foreign("Could not read runtime cleanup settings.", idleMinutes);

    if (minutes <= 0) return;

    const hosts = yield* foreign("Could not list runtime cleanup machines.", () =>
      bb.sdk.hosts.list(),
    );

    for (const host of hosts) {
      if (
        host.machineProviderId !== PERSISTENT_PROVIDER ||
        host.status !== "connected" ||
        host.lifecycle.phase !== "active"
      )
        continue;
      yield* foreign("Could not release idle runtimes.", (signal) =>
        clean(host.id, minutes, signal),
      ).pipe(
        Effect.catch(() =>
          Effect.sync(() =>
            bb.log.warn(`Idle runtime cleanup deferred for ${host.id}; will retry next sweep.`),
          ),
        ),
      );
    }
  });

  return { sweep: () => lock.withPermits(1)(sweep()) };
}
