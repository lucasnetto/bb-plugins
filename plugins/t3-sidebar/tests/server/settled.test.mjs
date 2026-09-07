import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/server";

async function withHost(run) {
  const rows = [
    makeThreadResponse({
      id: "one",
      title: "Finished",
      archivedAt: null,
      deletedAt: null,
      visibility: "visible",
      status: "active",
    }),
  ];
  const { bb, harness } = createFakePluginHost({
    pluginId: "t3-sidebar",
    sdk: {
      threads: {
        list: async ({ archived, offset, limit }) =>
          rows
            .filter((row) => (row.archivedAt !== null) === archived)
            .slice(offset, offset + limit),
        archive: async ({ threadId }) => {
          const thread = rows.find((row) => row.id === threadId);
          thread.archivedAt = Date.now();
          thread.status = "idle";
          return { ok: true };
        },
        unarchive: async ({ threadId }) => {
          rows.find((row) => row.id === threadId).archivedAt = null;
          return { ok: true };
        },
      },
    },
  });
  try {
    await plugin(bb);
    await run({ bb, harness, rows });
  } finally {
    await harness.lifecycle.dispose();
  }
}

test("settle archives even active threads, and un-settle is native unarchive", async () => {
  await withHost(async ({ harness }) => {
    await harness.behavior.callRpc("settled_set", { threadId: "one", settled: true });
    assert.equal(harness.inspection.sdk.callsTo("threads.archive").length, 1);
    const history = await harness.behavior.callRpc("settled_list", null);
    assert.equal(history.archivedThreads[0].id, "one");
    assert.ok(history.archivedThreads[0].archivedAt);
    assert.equal(harness.inspection.sdk.callsTo("environments.status").length, 0);
    await harness.behavior.callRpc("settled_set", { threadId: "one", settled: false });
    assert.equal(harness.inspection.sdk.callsTo("threads.unarchive").length, 1);
    assert.deepEqual(await harness.behavior.callRpc("settled_list", null), { archivedThreads: [] });
  });
});

test("all native archives are settled, regardless of legacy plugin state, with pagination", async () => {
  await withHost(async ({ bb, harness, rows }) => {
    await bb.storage.kv.set("settled", { one: 10 });
    rows.push(
      ...Array.from({ length: 105 }, (_, index) => ({
        ...rows[0],
        id: `old-${index}`,
        archivedAt: index + 1,
      })),
    );
    rows.push({ ...rows[0], id: "hidden", archivedAt: 1, visibility: "hidden" });
    rows.push({ ...rows[0], id: "deleted", archivedAt: 1, deletedAt: 2 });
    const result = await harness.behavior.callRpc("settled_list", null);
    assert.equal(result.archivedThreads.length, 105);
    assert.ok(result.archivedThreads.every((row) => row.id.startsWith("old-")));
    assert.equal(
      harness.inspection.sdk.callsTo("threads.archive").length,
      0,
      "reading must not migrate parked threads into archives",
    );
  });
});

test("native archive/delete events refresh the shelf", async () => {
  await withHost(async ({ harness, rows }) => {
    for (const event of ["thread.archived", "thread.deleted"]) {
      await harness.behavior.emitThreadEvent(event, { thread: rows[0] });
    }
    assert.equal(
      harness.realtimeSignals.filter((signal) => signal.channel === "settled-changed").length,
      2,
    );
  });
});

test("archive and restore failures propagate without a second source of truth", async () => {
  await withHost(async ({ harness }) => {
    harness.inspection.sdk.stub("threads.archive", async () => {
      throw new Error("offline");
    });
    await assert.rejects(
      harness.behavior.callRpc("settled_set", { threadId: "one", settled: true }),
      /offline/,
    );
    assert.deepEqual(await harness.behavior.callRpc("settled_list", null), { archivedThreads: [] });
    harness.inspection.sdk.stub("threads.unarchive", async () => {
      throw new Error("offline");
    });
    await assert.rejects(
      harness.behavior.callRpc("settled_set", { threadId: "one", settled: false }),
      /offline/,
    );
  });
});
