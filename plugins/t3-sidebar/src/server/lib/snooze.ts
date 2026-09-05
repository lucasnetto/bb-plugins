import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Semaphore } from "effect";
import { SNOOZED_CHANGED, snoozedMapSchema } from "../../shared/snooze-contract";
import { call, createRuntime, sync, decodeSchema } from "./server-effects";

export function createSnoozeHandlers(bb: BbPluginApi) {
  const runtime = createRuntime(bb);
  const lock = Semaphore.makeUnsafe(1);
  const read = Effect.fn("Snooze.read")(function* () {
    const raw = yield* call("snooze.read", () => bb.storage.kv.get("snoozed"));
    return yield* decodeSchema("snooze.decode", snoozedMapSchema, raw ?? {});
  });
  const update = Effect.fn("Snooze.update")(function* (
    threadId: string,
    until: number | null,
    remove = false,
  ) {
    const current = { ...(yield* read()) };
    const now = Date.now();
    if (until !== null) {
      yield* sync("snooze.validateTime", () => {
        if (until <= now) throw new Error("Choose a future wake time");
      });
      const threads = yield* call("snooze.thread", () => bb.sdk.threads.list());
      const thread = threads.find((item) => item.id === threadId);
      yield* sync("snooze.validateThread", () => {
        if (!thread || thread.archivedAt !== null || thread.deletedAt !== null)
          throw new Error("Thread is unavailable");
        if (thread.hasPendingInteraction || thread.queuedWork === "waiting")
          throw new Error("Threads waiting for input or queued work cannot be snoozed");
      });
      current[threadId] = { at: now, until };
    } else if (remove) {
      if (!current[threadId]) return { snoozed: current };
      delete current[threadId];
    } else {
      const entry = current[threadId];
      if (!entry || entry.until <= now) return { snoozed: current };
      current[threadId] = { ...entry, until: now };
    }
    yield* call("snooze.write", () => bb.storage.kv.set("snoozed", current));
    yield* sync("snooze.publish", () => bb.realtime.publish(SNOOZED_CHANGED, {}));
    return { snoozed: current };
  });
  const set = (threadId: string, until: number | null, remove = false) =>
    runtime.runPromise(update(threadId, until, remove).pipe(Semaphore.withPermit(lock)));

  // New turns and requests wake snoozed work even with every sidebar closed.
  bb.events.on("thread.active", async ({ thread }) => {
    await set(thread.id, null);
  });
  bb.events.on("interaction.pending", async ({ thread }) => {
    await set(thread.id, null);
  });
  bb.events.on("thread.failed", async ({ thread }) => {
    await set(thread.id, null);
  });
  bb.events.on("thread.archived", async ({ thread }) => {
    await set(thread.id, null, true);
  });
  bb.events.on("thread.deleted", async ({ thread }) => {
    await set(thread.id, null, true);
  });

  return {
    snoozed_list: () => runtime.runPromise(read().pipe(Effect.map((snoozed) => ({ snoozed })))),
    snoozed_set: ({ threadId, until }: { threadId: string; until: number | null }) =>
      set(threadId, until),
  };
}
