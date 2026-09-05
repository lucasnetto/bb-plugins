// bb-plugin-t3-sidebar — backend entry.
//
// The server bridges project management to BB's SDK and owns the one
// piece of state bb has no concept of: t3code-style "settled" threads. A
// settled thread is finished work the user parked out of the inbox; it
// collapses into the Settled shelf at the bottom of the list. The store is a
// map of threadId → settledAt (epoch ms) in bb.storage.kv, shared by every
// client of this bb through RPC + a realtime signal.
import { createSnoozeHandlers } from "./lib/snooze";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { Effect, Semaphore, Schema } from "effect";
import { call, sync, createRuntime, decodeSchema } from "./lib/server-effects";
import { AUTO_SETTLE_OPTIONS, SETTLED_CHANGED } from "../shared/contract";
import { createProjectSettingsHandlers, registerProjectAutoPull } from "./lib/project-settings";
import { createProjectThreadHandlers } from "./lib/project-thread-create";

import { rpcContract, type SettledMap } from "../shared/rpc-contract";
const SETTLED_KEY = "settled";

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    autoSettleAfter: {
      type: "select",
      label: "Auto-settle idle threads after",
      description:
        "Read, idle threads with no new attention for this long collapse into the Settled shelf on their own. Pinned threads never auto-settle.",
      options: [...AUTO_SETTLE_OPTIONS],
      default: "1 day",
    },
  });

  const runtime = createRuntime(bb);
  const settledLock = Semaphore.makeUnsafe(1);
  const read = Effect.fn("Settled.read")(function* () {
    const raw = yield* call("settled.read", () => bb.storage.kv.get(SETTLED_KEY));
    return yield* decodeSchema(
      "settled.decode",
      Schema.Record(Schema.String, Schema.Finite),
      raw ?? {},
    );
  });
  const setSettled = Effect.fn("Settled.set")(function* (
    threadIds: readonly string[],
    settled: boolean,
  ) {
    const current = yield* read();
    const now = Date.now();
    const next: SettledMap = settled
      ? { ...current, ...Object.fromEntries(threadIds.map((id) => [id, now])) }
      : Object.fromEntries(Object.entries(current).filter(([id]) => !threadIds.includes(id)));
    yield* call("settled.write", () => bb.storage.kv.set(SETTLED_KEY, next));
    yield* sync("settled.publish", () =>
      bb.realtime.publish(SETTLED_CHANGED, { count: Object.keys(next).length }),
    );
    return next;
  });

  bb.rpc.register(rpcContract, {
    ...createSnoozeHandlers(bb),
    ...createProjectSettingsHandlers(bb),
    ...createProjectThreadHandlers(bb),
    project_hosts: () =>
      runtime.runPromise(
        call("hosts.list", () => bb.sdk.hosts.list()).pipe(
          Effect.map((hosts) =>
            hosts
              .filter((host) => host.status === "connected")
              .map(({ id, name }) => ({ id, name })),
          ),
        ),
      ),
    project_directory: (input) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const listing = yield* call("hosts.directory", () => bb.sdk.hosts.directory(input));
          return {
            directory: listing.directory,
            parent: listing.parent,
            entries: listing.entries
              .filter((entry) => entry.kind === "directory")
              .map(({ name, path }) => ({ name, path }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          };
        }),
      ),
    project_create: ({ hostId, path }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const name =
            path
              .replace(/[\\/]+$/u, "")
              .split(/[\\/]/u)
              .at(-1) || "Root";
          const project = yield* call("projects.create", () =>
            bb.sdk.projects.create({
              name,
              source: { type: "local_path", hostId, path },
            }),
          );
          return { id: project.id };
        }),
      ),
    project_remove: ({ projectId }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* call("projects.list", () =>
            bb.sdk.projects.list({ includePersonal: true }),
          );
          const project = projects.find((item) => item.id === projectId);
          if (!project || project.kind === "personal")
            return yield* sync("projects.remove", () => {
              throw new Error("This project cannot be removed");
            });
          yield* call("projects.delete", () => bb.sdk.projects.delete({ projectId }));
          return null;
        }),
      ),
    settled_list: () => runtime.runPromise(read().pipe(Effect.map((settled) => ({ settled })))),
    settled_set: ({ threadIds, settled }) =>
      runtime.runPromise(
        setSettled(threadIds, settled).pipe(
          Semaphore.withPermit(settledLock),
          Effect.map((settled) => ({ settled })),
        ),
      ),
  });

  registerProjectAutoPull(bb);

  return runtime.runPromise(sync("log.loaded", () => bb.log.info("loaded")));
}
