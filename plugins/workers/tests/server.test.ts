import { afterEach, expect, test } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { rpcContract, PAGE_SIZE } from "../contract";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

function setup() {
  const host = createFakePluginHost({
    pluginId: "workers",
    sdk: {
      threads: {
        list: async ({ archived } = {}) =>
          Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
            ...makeThreadResponse({
              id: `${archived ? "archived" : "worker"}-${index}`,
              archivedAt: archived ? 1 : null,
              parentThreadId: "parent",
              visibility: "hidden",
            }),
            hasPendingInteraction: index === 0,
          })),
        defaultExecutionOptions: async () => ({ model: "gpt-5.6-luna", reasoningLevel: "low" }),
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            parentThreadId: threadId === "foreign" ? "another-parent" : "parent",
          }),
        update: async ({ threadId }) => makeThreadResponse({ id: threadId }),
      },
    },
  });
  plugin(host.bb);
  disposers.push(() => host.harness.lifecycle.dispose());
  return host.harness;
}

test("queries direct children including hidden workers, bounds metadata reads, and retains paging", async () => {
  const harness = setup();
  const result = rpcContract.list.output.parse(
    await harness.behavior.callRpc("list", { threadId: "parent", offset: 0 }),
  );
  expect(result.workers).toHaveLength(PAGE_SIZE);
  expect(result.hasMore).toBe(true);
  expect(result.workers[0]?.archived).toBe(true);
  expect(harness.inspection.sdk.callsTo("threads.list")[1]?.[0]).toMatchObject({
    archived: true,
    includeHidden: true,
  });
  expect(result.workers[0]).toMatchObject({
    visibility: "hidden",
    model: "gpt-5.6-luna",
    reasoningLevel: "low",
    hasPendingInteraction: true,
  });
  expect(harness.inspection.sdk.callsTo("threads.list")[0]?.[0]).toEqual({
    parentThreadId: "parent",
    includeHidden: true,
    archived: false,
    offset: 0,
    limit: 100,
  });
  expect(harness.inspection.sdk.callsTo("threads.defaultExecutionOptions")).toHaveLength(PAGE_SIZE);
});

test("publishes worker changes to their parent and ignores root lifecycle events", async () => {
  const harness = setup();
  await harness.behavior.emitThreadEvent("thread.idle", {
    thread: makeThreadResponse({ id: "child", parentThreadId: "parent" }),
    lastAssistantText: "done",
  });
  await harness.behavior.emitThreadEvent("thread.idle", {
    thread: makeThreadResponse({ parentThreadId: null }),
    lastAssistantText: "done",
  });
  expect(harness.realtimeSignals).toHaveLength(1);
});

test("rejects invalid paging input at the RPC boundary", async () => {
  const harness = setup();
  await expect(
    harness.behavior.callRpc("list", { threadId: "parent", offset: -1 }),
  ).rejects.toThrow();
  expect(harness.inspection.sdk.callsTo("threads.list")).toHaveLength(0);
});
