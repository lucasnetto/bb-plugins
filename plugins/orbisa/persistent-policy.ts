import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Semaphore } from "effect";
import { foreign } from "./persistent-effects.ts";
import { PERSISTENT_PROVIDER } from "./persistent-resource.ts";

// Persistent slots can suspend, but never retire when their threads are archived.
export function createPersistentPolicy(
  bb: BbPluginApi,
  idleMinutes: () => Promise<number>,
  now = Date.now,
) {
  const lock = Semaphore.makeUnsafe(1);
  const key = (hostId: string) => `persistent-activity/${hostId}`;

  const bump = Effect.fn("Persistent.activity")(function* (hostId: string) {
    const host = yield* foreign("Could not inspect persistent machine.", (signal) =>
      bb.sdk.hosts.get({ hostId, signal }),
    );

    if (host.machineProviderId === PERSISTENT_PROVIDER)
      yield* foreign("Could not record machine activity.", () =>
        bb.storage.kv.set(key(hostId), now()),
      );
  });

  const sweep = Effect.fn("Persistent.idleSweep")(function* () {
    const minutes = yield* foreign("Could not read idle settings.", idleMinutes);

    if (minutes <= 0) return;

    const hosts = yield* foreign("Could not list machines.", (signal) =>
      bb.sdk.hosts.list({ signal }),
    );

    const machines = hosts.filter(
      (host) => host.machineProviderId === PERSISTENT_PROVIDER && host.lifecycle.phase === "active",
    );

    if (!machines.length) return;
    const threads: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];

    for (let offset = 0; ; offset += 100) {
      const page = yield* foreign("Could not inspect active threads.", (signal) =>
        bb.sdk.threads.list({ archived: false, includeHidden: true, limit: 100, offset, signal }),
      );

      threads.push(...page);

      if (page.length < 100) break;
    }

    if (threads.some((thread) => thread.status === "starting")) return;

    for (const host of machines) {
      const environments = yield* foreign("Could not inspect machine environments.", (signal) =>
        bb.sdk.environments.list({ hostId: host.id, signal }),
      );

      const ids = new Set(environments.map((environment) => environment.id));

      if (
        threads.some(
          (thread) =>
            thread.environmentId &&
            ids.has(thread.environmentId) &&
            ["active", "stopping"].includes(thread.status),
        )
      ) {
        yield* bump(host.id);
        continue;
      }

      const saved = yield* foreign("Could not read idle activity.", () =>
        bb.storage.kv.get<number>(key(host.id)),
      );

      if (saved === undefined) {
        yield* bump(host.id);
        continue;
      }

      if (Number.isFinite(saved) && now() - saved >= minutes * 60_000) {
        // Core atomically refuses suspension with active threads or open terminals.
        yield* foreign("Persistent machine suspension deferred.", () =>
          bb.sdk.hosts.experimental_suspend({ hostId: host.id }),
        ).pipe(
          Effect.catch(() =>
            Effect.sync(() =>
              bb.log.warn(
                `Could not suspend persistent machine ${host.id}; suspension may have been refused or failed. Will retry next sweep.`,
              ),
            ),
          ),
        );
      }
    }
  });

  return {
    bump: (hostId: string) => lock.withPermits(1)(bump(hostId)),
    sweep: () => lock.withPermits(1)(sweep()),
  };
}
