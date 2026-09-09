import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { SIDE_THREAD_CHANGED } from "../../shared/side-thread-contract";
import { call, createRuntime, sync } from "./server-effects";

type Thread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

function isLiveSideThread(thread: Thread): boolean {
  return (
    thread.originKind === "fork" &&
    thread.originPluginId === "side-chat" &&
    thread.archivedAt === null &&
    thread.deletedAt === null
  );
}

export function createSideThreadHandlers(bb: BbPluginApi) {
  const runtime = createRuntime(bb);
  const get = (threadId: string) =>
    call("threads.get", (signal) => bb.sdk.threads.get({ threadId, signal }));

  const status = Effect.fn("SideThread.status")(function* (threadId: string) {
    const thread = yield* get(threadId);
    return { canPromote: isLiveSideThread(thread) && thread.visibility === "hidden" };
  });

  const promote = Effect.fn("SideThread.promote")(function* (threadId: string) {
    const thread = yield* get(threadId);
    if (!isLiveSideThread(thread)) {
      return yield* sync("sideThread.validate", () => {
        throw new Error("Only an unarchived side chat can be promoted");
      });
    }
    // Repeated clicks from another client are harmless. Keep the same thread,
    // provider session, source lineage and environment; only change placement.
    if (thread.visibility !== "visible" || thread.parentThreadId !== null) {
      yield* call("threads.update", () =>
        bb.sdk.threads.update({ threadId, visibility: "visible", parentThreadId: null }),
      );
    }
    yield* sync("sideThread.publish", () => bb.realtime.publish(SIDE_THREAD_CHANGED, {}));
    return { threadId };
  });

  return {
    side_thread_status: ({ threadId }: { threadId: string }) =>
      runtime.runPromise(status(threadId)),
    side_thread_promote: ({ threadId }: { threadId: string }) =>
      runtime.runPromise(promote(threadId)),
  };
}
