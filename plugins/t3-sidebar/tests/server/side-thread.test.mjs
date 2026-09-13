import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/server";

async function withHost(run) {
  const state = {
    thread: makeThreadResponse({
      id: "side",
      originKind: "fork",
      originPluginId: "side-chat",
      visibility: "hidden",
      sourceThreadId: "source",
      parentThreadId: "parent",
      archivedAt: null,
      deletedAt: null,
      status: "active",
    }),
    updates: [],
  };

  const { bb, harness } = createFakePluginHost({
    pluginId: "t3-sidebar",
    sdk: {
      threads: {
        get: async () => state.thread,
        update: async ({ threadId, ...patch }) => {
          assert.equal(threadId, "side");
          state.updates.push(patch);
          state.thread = { ...state.thread, ...patch };

          return state.thread;
        },
      },
    },
  });

  try {
    await plugin(bb);
    await run({ state, harness });
  } finally {
    await harness.lifecycle.dispose();
  }
}

test("promotes an active side chat in place and repeated promotion is idempotent", async () => {
  await withHost(async ({ state, harness }) => {
    const before = state.thread;
    assert.deepEqual(await harness.behavior.callRpc("side_thread_status", { threadId: "side" }), {
      canPromote: true,
    });

    for (let click = 0; click < 2; click++) {
      assert.deepEqual(
        await harness.behavior.callRpc("side_thread_promote", { threadId: "side" }),
        {
          threadId: "side",
        },
      );
    }

    assert.deepEqual(state.updates, [{ visibility: "visible", parentThreadId: null }]);
    assert.deepEqual(state.thread, { ...before, visibility: "visible", parentThreadId: null });
    assert.deepEqual(await harness.behavior.callRpc("side_thread_status", { threadId: "side" }), {
      canPromote: false,
    });
    assert.equal(harness.inspection.sdk.callsTo("threads.spawn").length, 0);
    assert.equal(harness.inspection.sdk.callsTo("threads.stop").length, 0);
    assert.equal(harness.inspection.sdk.callsTo("threads.fork").length, 0);
    assert.equal(harness.realtimeSignals.at(-1).channel, "side-thread-changed");
  });
});

test("does not expose workers, ordinary forks, or archived/deleted side chats", async () => {
  await withHost(async ({ state, harness }) => {
    const original = state.thread;

    for (const patch of [
      { originPluginId: "workers" },
      { originPluginId: null },
      { originKind: "plugin" },
      { archivedAt: 1 },
      { deletedAt: 1 },
    ]) {
      state.thread = { ...original, ...patch };
      assert.deepEqual(await harness.behavior.callRpc("side_thread_status", { threadId: "side" }), {
        canPromote: false,
      });
      await assert.rejects(
        harness.behavior.callRpc("side_thread_promote", { threadId: "side" }),
        /Only an unarchived side chat/,
      );
    }

    assert.deepEqual(state.updates, []);
    assert.deepEqual(harness.realtimeSignals, []);
  });
});

test("invalid input and failed updates leave the side chat hidden without announcing success", async () => {
  await withHost(async ({ state, harness }) => {
    for (const input of [null, {}, { threadId: "" }, { threadId: 1 }]) {
      await assert.rejects(harness.behavior.callRpc("side_thread_promote", input));
    }

    assert.equal(harness.inspection.sdk.callsTo("threads.get").length, 0);
    harness.inspection.sdk.stub("threads.update", async () => {
      throw new Error("Connection lost");
    });
    await assert.rejects(
      harness.behavior.callRpc("side_thread_promote", { threadId: "side" }),
      /Connection lost/,
    );
    assert.equal(state.thread.visibility, "hidden");
    assert.deepEqual(harness.realtimeSignals, []);
  });
});
