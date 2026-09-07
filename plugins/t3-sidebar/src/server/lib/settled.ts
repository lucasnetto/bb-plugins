import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { SETTLED_CHANGED } from "../../shared/contract";
import { call, createRuntime, sync } from "./server-effects";

/** Settled is the sidebar's name for BB's archived threads. No plugin state. */
export function createSettledHandlers(bb: BbPluginApi) {
  const runtime = createRuntime(bb);
  const publish = () => bb.realtime.publish(SETTLED_CHANGED, {});
  bb.events.on("thread.archived", publish);
  bb.events.on("thread.deleted", publish);

  const list = Effect.fn("Settled.list")(function* () {
    const archivedThreads = [];
    for (let offset = 0; ; offset += 100) {
      const page = yield* call("threads.list", (signal) =>
        bb.sdk.threads.list({ archived: true, limit: 100, offset, signal }),
      );
      archivedThreads.push(
        ...page
          .filter(
            (thread) =>
              thread.archivedAt !== null &&
              thread.deletedAt === null &&
              thread.visibility === "visible",
          )
          .map(
            ({
              id,
              projectId,
              title,
              titleFallback,
              providerId,
              createdAt,
              updatedAt,
              archivedAt,
            }) => ({
              id,
              projectId,
              title,
              titleFallback,
              providerId,
              createdAt,
              updatedAt,
              archivedAt: archivedAt!,
            }),
          ),
      );
      if (page.length < 100) return { archivedThreads };
    }
  });
  const set = Effect.fn("Settled.set")(function* (threadId: string, settled: boolean) {
    // The native lifecycle stops work and owns environment cleanup. Settling
    // must not leave a busy or changed thread merely hidden in a plugin map.
    yield* call(settled ? "threads.archive" : "threads.unarchive", () =>
      settled ? bb.sdk.threads.archive({ threadId }) : bb.sdk.threads.unarchive({ threadId }),
    );
    yield* sync("settled.publish", publish);
    return null;
  });
  return {
    settled_list: () => runtime.runPromise(list()),
    settled_set: ({ threadId, settled }: { threadId: string; settled: boolean }) =>
      runtime.runPromise(set(threadId, settled)),
  };
}
