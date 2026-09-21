import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { createRecovery } from "../../src/server/recovery.js";
import plugin from "../../src/server/server.js";

type Event = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>>[number];

const dispose: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of dispose.splice(0)) await cleanup();
});

const execution = {
  model: "composer-2.5",
  permissionMode: "full" as const,
  reasoningLevel: "none" as const,
  serviceTier: "fast" as const,
  source: "client/turn/requested" as const,
};

const row = (seq: number) => ({
  id: `event-${seq}`,
  seq,
  threadId: "source",
  createdAt: seq,
  scope: { kind: "thread" as const },
});

function user(seq: number, text: string): Event {
  return {
    ...row(seq),
    type: "client/turn/requested",
    data: {
      direction: "outbound",
      execution,
      initiator: "user",
      input: [
        { type: "text", text, mentions: [] },
        { type: "localFile", path: "/workspace/notes.md" },
      ],
      request: { method: "turn/start", params: {} },
      requestId: `request-${seq}`,
      senderThreadId: null,
      source: "tell",
      target: { kind: "new-turn" },
    },
  };
}

function assistant(seq: number, text: string): Event {
  return {
    ...row(seq),
    type: "item/completed",
    data: {
      providerThreadId: "agent-source",
      item: { type: "agentMessage", id: `a-${seq}`, text },
    },
  };
}

function fixture(
  history: Event[] = [
    user(1, "Build the app"),
    assistant(2, "Changed the parser"),
    user(3, "Keep my local edits"),
  ],
) {
  let source = makeThreadResponse({
    id: "source",
    providerId: "cursor-sdk",
    projectId: "project",
    environmentId: "environment",
    status: "error",
    runtime: { displayStatus: "error", hostReconnectGraceExpiresAt: null },
    title: "Parser",
    updatedAt: 1,
  });

  let spawnFailure = false;
  let changeDuringRead = false;

  const host = createFakePluginHost({
    pluginId: "cursor-sdk",
    dataDir: "/tmp/.bb",
    sdk: {
      threads: {
        get: async () => source,
        defaultExecutionOptions: async () => execution,
        spawn: async () => {
          if (spawnFailure) throw new Error("Lost connection after submission");

          return makeThreadResponse({ id: "recovered" });
        },
        events: {
          list: async (input) => {
            if (changeDuringRead) source = { ...source, updatedAt: source.updatedAt + 1 };

            const events = history.filter(
              (event) =>
                input.types?.includes(event.type) &&
                (!input.beforeSeq || event.seq < Number(input.beforeSeq)),
            );

            return (input.order === "desc" ? [...events].reverse() : events).slice(
              0,
              Number(input.limit ?? 100),
            );
          },
        },
      },
    },
  });

  dispose.push(() => host.harness.lifecycle.dispose());

  return {
    ...host,
    recovery: createRecovery(host.bb),
    setSource: (value: Partial<typeof source>) => {
      source = { ...source, ...value };
    },
    failSpawn: () => {
      spawnFailure = true;
    },
    changeDuringRead: () => {
      changeDuringRead = true;
    },
  };
}

test("preview is read-only; recovery preserves execution and environment without replaying work", async () => {
  const f = fixture();
  const preview = await f.recovery.preview("source");
  expect(preview.prompt).toContain("Build the app");
  expect(preview.prompt).toContain("Keep my local edits");
  expect(preview.prompt).toContain("contents not copied: /workspace/notes.md");
  expect(preview.prompt).toContain("Do not call tools");
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  const result = await f.recovery.recover("source");
  expect(result).toMatchObject({ threadId: "recovered", sourceThreadId: "source" });
  const calls = f.harness.inspection.sdk.callsTo("threads.spawn");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject([
    {
      environment: { type: "reuse", environmentId: "environment" },
      parentThreadId: "source",
      providerId: "cursor-sdk",
      model: "composer-2.5",
      serviceTier: "fast",
      visibility: "visible",
    },
  ]);
  expect(f.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
  expect(f.harness.inspection.sdk.callsTo("threads.delete")).toHaveLength(0);
});

test("concurrent and repeated requests reuse the same recovery, including after restart", async () => {
  const f = fixture();
  await Promise.all([f.recovery.recover("source"), f.recovery.recover("source")]);
  expect(await createRecovery(f.bb).recover("source")).toMatchObject({
    threadId: "recovered",
    reused: true,
  });
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
});

test("uncertain creation is recorded and never automatically submitted twice", async () => {
  const f = fixture();
  f.failSpawn();
  await expect(f.recovery.recover("source")).rejects.toThrow("Lost connection");
  await expect(createRecovery(f.bb).recover("source")).rejects.toThrow("outcome is uncertain");
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  await expect(f.recovery.recover("source", true)).rejects.toThrow("Lost connection");
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
});

test("refuses running, queued, missing-environment, and other-provider conversations", async () => {
  for (const value of [
    { status: "active" as const },
    { queuedMessageCount: 1 },
    { environmentId: null },
    { providerId: "codex" },
  ]) {
    const f = fixture();
    f.setSource(value);
    await expect(f.recovery.recover("source")).rejects.toThrow();
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  }
});

test("refuses empty history and a source that changes while its history is being read", async () => {
  await expect(fixture([]).recovery.recover("source")).rejects.toThrow("no saved conversation");
  const f = fixture();
  f.changeDuringRead();
  await expect(f.recovery.recover("source")).rejects.toThrow("changed while reading");
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
});

test("pages through history and explicitly marks truncation while retaining original and recent requests", async () => {
  const history = [
    user(1, "Original goal"),
    ...Array.from({ length: 140 }, (_, i) => assistant(i + 2, "Progress ".repeat(100))),
    user(200, "Latest constraint"),
  ];

  const preview = await fixture(history).recovery.preview("source");
  expect(preview.truncated).toBe(true);
  expect(preview.prompt).toContain("Original goal");
  expect(preview.prompt).toContain("Latest constraint");
  expect(preview.prompt.length).toBeLessThan(100_000);
});

test("CLI rejects unknown flags and preview never creates a thread", async () => {
  const f = fixture();
  plugin(f.bb);
  expect((await f.harness.behavior.runCli(["recover", "source", "--preveiw"])).exitCode).toBe(1);
  const preview = await f.harness.behavior.runCli(["recover", "source", "--preview", "--json"]);
  expect(preview.exitCode).toBe(0);
  expect(JSON.parse(preview.stdout).prompt).toContain("Build the app");
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
});
