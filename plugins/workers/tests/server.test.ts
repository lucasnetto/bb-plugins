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
        defaultExecutionOptions: async () => ({
          model: "gpt-5.6-luna",
          reasoningLevel: "low",
          permissionMode: "accept-edits",
        }),
        spawn: async () => makeThreadResponse({ id: "new-worker", visibility: "hidden" }),
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            projectId: "parent-project",
            environmentId: "parent-environment",
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

test("spawns hidden children using the caller's environment and permissions", async () => {
  const harness = setup();
  await harness.behavior.callAgentTool(
    "bb_worker_thread",
    {
      title: "Research",
      prompt: "Investigate the issue",
    },
    { threadId: "parent" },
  );
  expect(harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
    title: "Research",
    prompt: "Investigate the issue",
    projectId: "parent-project",
    parentThreadId: "parent",
    environment: { type: "reuse", environmentId: "parent-environment" },
    permissionMode: "accept-edits",
    visibility: "hidden",
    startedOnBehalfOf: { initiator: "agent", senderThreadId: "parent" },
  });
  expect(harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0]).not.toHaveProperty("model");
});

test("passes explicit execution options and supports nested workers", async () => {
  const harness = setup();
  await harness.behavior.callAgentTool(
    "bb_worker_thread",
    {
      title: "Research",
      prompt: "Investigate",
      providerId: "pi",
      model: "chosen-model",
      reasoningLevel: "high",
    },
    { threadId: "worker" },
  );
  expect(harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
    parentThreadId: "worker",
    visibility: "hidden",
    providerId: "pi",
    model: "chosen-model",
    reasoningLevel: "high",
  });
});

test("rejects empty tasks and caller overrides of worker safety fields", async () => {
  const harness = setup();

  for (const input of [
    { title: " ", prompt: "Task" },
    { title: "Task", prompt: " " },
    ...["visibility", "parentThreadId", "projectId", "environment", "permissionMode"].map(
      (key) => ({
        title: "Task",
        prompt: "Task",
        [key]: "override",
      }),
    ),
  ]) {
    await expect(harness.behavior.callAgentTool("bb_worker_thread", input)).rejects.toThrow();
  }

  expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
});

test("rejects invalid paging input at the RPC boundary", async () => {
  const harness = setup();
  await expect(
    harness.behavior.callRpc("list", { threadId: "parent", offset: -1 }),
  ).rejects.toThrow();
  expect(harness.inspection.sdk.callsTo("threads.list")).toHaveLength(0);
});
