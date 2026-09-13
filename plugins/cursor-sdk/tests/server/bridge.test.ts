import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  JsonlLocalAgentStore,
  type SDKAgent,
  type Run,
  type SDKMessage,
  type SDKModel,
  type AgentOptions,
  type SendOptions,
} from "@cursor/sdk";
import {
  experimental_runBridgeConformance,
  experimental_formatConformanceReport,
  experimental_assembleCapturedThreadEvents,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  threadDeltaSchema,
  threadStartParamsSchema,
  turnStartParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { Deferred, Effect } from "effect";
import { z } from "zod";
import { createSdkBridge } from "../../src/server/bridge.js";
import { boundedValue, RunEvents, runStatus } from "../../src/server/events.js";
import { modelCatalog } from "../../src/server/models.js";
import { safeMessage, SdkError } from "../../src/server/operations.js";
import type { SdkModule } from "../../src/server/runtime.js";

type StartInput = z.input<typeof threadStartParamsSchema>;

type TurnInput = z.input<typeof turnStartParamsSchema>;

type TurnOverrides = Partial<
  Pick<TurnInput["options"], "model" | "reasoningLevel" | "serviceTier" | "providerOptions">
>;

type WireParams = z.infer<ReturnType<typeof z.json>>;

const options = {
  model: "test-model",
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
  providerOptions: { profile: "personal" },
} satisfies StartInput["options"];

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(catalog: SDKModel[] = [{ id: "test-model", displayName: "Test" }], cloud = false) {
  const dataDir = mkdtempSync(join(tmpdir(), "bb-cursor-sdk-unit-"));
  const providerThreadId = cloud ? "bc-1" : "agent-1";

  const executionOptions = {
    ...options,
    providerOptions: { profile: "personal", runtime: cloud ? "cloud" : "local" },
  };

  let remoteStatus: "running" | "finished" = "finished";
  let remoteMissing = false;
  let sourceCalls = 0;
  let completeSend: (() => void) | undefined;
  const messages: unknown[] = [];
  const errors: unknown[] = [];
  const listeners = new Set<() => void>();
  const created: AgentOptions[] = [];
  const resumed: string[] = [];
  const resumedOptions: AgentOptions[] = [];
  const sent: Array<{ text: string; options?: SendOptions }> = [];
  let cancelled = 0;
  let disposed = 0;
  const disposal = Deferred.makeUnsafe<void>();
  const cancellation = Deferred.makeUnsafe<void>();
  let sequence = 0;

  const makeAgent = (agentId: string): SDKAgent => {
    const detach = new Set<() => void>();

    return {
      agentId,
      model: undefined,
      async send(message, sendOptions) {
        const text = z
          .union([z.string(), z.object({ text: z.string() }).transform((input) => input.text)])
          .parse(message);

        sent.push({ text, options: sendOptions });

        if (text === "send-failure") throw new Error("Could not send");

        if (text.includes("slow-send"))
          await new Promise<void>((resolve) => {
            completeSend = resolve;
          });
        const id = `run-${++sequence}`;
        let interrupted = false;
        let release: (() => void) | undefined;

        const block = new Promise<void>((resolve) => {
          release = resolve;
          detach.add(resolve);
        });

        const run: Run = {
          id,
          agentId,
          get status() {
            return interrupted ? "cancelled" : "finished";
          },
          supports: () => true,
          unsupportedReason: () => undefined,
          async *stream(): AsyncGenerator<SDKMessage, void> {
            if (text === "stream-failure") throw new Error("Connection dropped");

            if (text.includes("hold")) await block;

            if (text.includes("call-tool"))
              await sendOptions?.local?.customTools?.testTool?.execute({ value: "hello" }, {});

            if (!interrupted && !text.includes("zero")) {
              yield {
                type: "assistant",
                agent_id: agentId,
                run_id: id,
                message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
              };
            }
          },
          async wait() {
            return {
              id,
              status: interrupted ? "cancelled" : "finished",
              result: text.includes("zero") ? "" : "Hello",
            };
          },
          async cancel() {
            cancelled++;
            interrupted = true;
            release?.();
            await Effect.runPromise(Deferred.succeed(cancellation, undefined));
          },
          async conversation() {
            return [];
          },
          onDidChangeStatus: () => () => {},
        };

        return run;
      },
      close() {},
      async reload() {},
      async [Symbol.asyncDispose]() {
        disposed++;

        for (const release of detach) release();
        detach.clear();
        await Effect.runPromise(Deferred.succeed(disposal, undefined));
      },
      async listArtifacts() {
        return [];
      },
      async downloadArtifact() {
        return Buffer.alloc(0);
      },
      async getUsage() {
        throw new Error("unused");
      },
    };
  };

  const sdk: SdkModule = {
    JsonlLocalAgentStore,
    Agent: {
      async get(id) {
        if (remoteMissing) throw Object.assign(new Error("Missing"), { code: "agent_not_found" });

        return {
          agentId: id,
          name: "Test",
          summary: "",
          lastModified: 0,
          runtime: "cloud" as const,
          status: remoteStatus,
        };
      },
      async create(value) {
        created.push(value);

        return makeAgent(
          value.agentId ?? (value.cloud ? `bc-${created.length}` : `agent-${created.length}`),
        );
      },
      async resume(id, value) {
        resumed.push(id);

        if (value) resumedOptions.push(value);

        return makeAgent(id);
      },
    },
    Cursor: {
      async me() {
        return { apiKeyName: "test", createdAt: "2026-01-01" };
      },
      models: {
        async list() {
          return catalog;
        },
      },
    },
  };

  const bridge = createSdkBridge(
    {
      load: () => Effect.succeed(sdk),
      key: () => Effect.succeed("test-key"),
      source: () => {
        sourceCalls++;

        return Effect.succeed({
          repository: "https://github.com/example/repo",
          ref: "a".repeat(40),
        });
      },
    },
    (line) => {
      messages.push(JSON.parse(line));

      if (JSON.parse(line).error) errors.push(JSON.parse(line));

      for (const listener of listeners) listener();
    },
  );

  bridge.start?.({ pluginId: "cursor-sdk", dataDir, tempDir: "/tmp" });
  cleanups.push(() => {
    bridge.onClose?.();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const messageSchema = z.object({
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().optional(),
    result: z.unknown().optional(),
    error: z.object({ code: z.number(), message: z.string() }).optional(),
    params: z.unknown().optional(),
  });

  const waitFor = (predicate: (message: z.infer<typeof messageSchema>) => boolean) =>
    new Promise<z.infer<typeof messageSchema>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        listeners.delete(check);
        reject(new Error("Timed out waiting for bridge output"));
      }, 5000);

      function check() {
        for (const raw of messages) {
          const message = messageSchema.parse(raw);

          if (predicate(message)) {
            clearTimeout(timeout);
            listeners.delete(check);
            resolve(message);

            return;
          }
        }
      }

      listeners.add(check);
      check();
    });

  let requestId = 0;

  const request = (method: string, params: WireParams | StartInput | TurnInput) => {
    const id = ++requestId;
    bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));

    return waitFor((message) => message.id === id);
  };

  const init = () =>
    request("initialize", {
      protocolVersion: 2,
      client: { name: "test", version: "1" },
      grammarVersions: [2, 3],
    });

  const start = (extra: Partial<StartInput> = {}) =>
    request("thread/start", {
      threadId: "thread",
      cwd: "/tmp",
      instructionMode: "append",
      options: executionOptions,
      ...extra,
    });

  const turn = (text: string, execution: TurnOverrides = {}) =>
    request("turn/start", {
      threadId: "thread",
      providerThreadId,
      clientRequestId: "creq_abcdefghij",
      input: [{ type: "text", text, mentions: [] }],
      options: { ...executionOptions, ...execution },
    });

  const deltas = () =>
    messages.flatMap((raw) => {
      const message = messageSchema.parse(raw);

      return message.method === "thread/delta"
        ? z.object({ deltas: z.array(threadDeltaSchema) }).parse(message.params).deltas
        : [];
    });

  const settled = () => waitFor(() => deltas().some((d) => d.kind === "turn.boundary"));

  return {
    bridge,
    executionOptions,
    sourceCalls: () => sourceCalls,
    completeSend: () => completeSend?.(),
    remoteStatus: (status: "running" | "finished") => {
      remoteStatus = status;
    },
    remoteMissing: () => {
      remoteMissing = true;
    },
    messages,
    errors,
    created,
    resumed,
    resumedOptions,
    sent,
    init,
    start,
    turn,
    request,
    waitFor,
    settled,
    deltas,
    cancelled: () => cancelled,
    disposed: () => disposed,
    waitForDisposal: () => Effect.runPromise(Deferred.await(disposal)),
    waitForCancellation: () => Effect.runPromise(Deferred.await(cancellation)),
  };
}

describe("provider bridge", () => {
  test("passes the public provider conformance suite", async () => {
    const f = fixture();

    const report = await experimental_runBridgeConformance({
      providerId: "cursor-sdk",
      timeoutMs: 3000,
      transport: { send: f.bridge.handleLine, takeMessages: () => f.messages.splice(0) },
      session: {
        cwd: "/tmp",
        options,
        promptInput: [{ type: "text", text: "hello", mentions: [] }],
        zeroWorkPromptInput: [{ type: "text", text: "zero", mentions: [] }],
        interruptiblePromptInput: [{ type: "text", text: "hold", mentions: [] }],
      },
    });

    expect(
      report.passed,
      experimental_formatConformanceReport(report) + JSON.stringify(f.errors),
    ).toBe(true);
  });

  test("retains the SDK identity on resume and does not duplicate final text", async () => {
    const f = fixture();
    await f.init();
    expect((await f.start()).error).toBeUndefined();
    expect((await f.turn("hello")).error).toBeUndefined();
    await f.settled();
    expect(
      f
        .deltas()
        .filter((d) => d.kind === "item.textDelta")
        .map((d) => ("text" in d ? d.text : ""))
        .join(""),
    ).toBe("Hello");

    const assembled = experimental_assembleCapturedThreadEvents(
      z.array(z.record(z.string(), z.unknown())).parse(f.messages),
      "cursor-sdk",
    );

    expect(assembled).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({ type: "agentMessage", text: "Hello" }),
      }),
    );
    await f.request("thread/stop", {
      threadId: "thread",
      providerThreadId: "agent-1",
      activeTurnId: null,
      intent: "release",
    });
    await f.request("thread/resume", {
      threadId: "thread",
      providerThreadId: "agent-1",
      cwd: "/tmp",
      instructionMode: "append",
      options,
    });
    expect(f.resumed).toEqual(["agent-1"]);
    expect(f.disposed()).toBe(1);
  });

  test("cancels an active run exactly once and emits one interrupted boundary", async () => {
    const f = fixture();
    await f.init();
    await f.start();
    expect((await f.turn("hold")).error).toBeUndefined();
    await f.request("thread/stop", {
      threadId: "thread",
      providerThreadId: "agent-1",
      activeTurnId: "turn",
      intent: "interrupt",
    });
    await f.settled();
    expect(f.cancelled()).toBe(1);
    expect(f.deltas().filter((d) => d.kind === "turn.boundary")).toEqual([
      expect.objectContaining({ status: "interrupted" }),
    ]);
  });

  test("forwards SDK custom tools to BB and accepts their response", async () => {
    const f = fixture();
    await f.init();
    await f.start({
      dynamicTools: [
        {
          name: "testTool",
          description: "Test tool",
          inputSchema: { type: "object", properties: { value: { type: "string" } } },
        },
      ],
    });
    expect((await f.turn("call-tool")).error).toBeUndefined();
    const call = await f.waitFor((message) => message.method === "item/tool/call");
    expect(call.params).toMatchObject({
      threadId: "thread",
      providerThreadId: "agent-1",
      tool: "testTool",
      arguments: { value: "hello" },
    });
    f.bridge.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: call.id,
        result: { content: [{ type: "text", text: "done" }] },
      }),
    );
    await f.settled();
  });

  test("rejects invalid parameters and unsupported methods with protocol errors", async () => {
    const f = fixture();
    await f.init();
    expect((await f.request("thread/start", {})).error?.code).toBe(-32602);
    expect((await f.request("thread/nope", {})).error?.code).toBe(-32601);
    expect(
      (
        await f.start({
          options: {
            ...options,
            permissionMode: "auto",
            permissionScope: "workspace",
            approvalReviewer: "automatic",
            permissionEscalation: "ask",
          },
        })
      ).error?.message,
    ).toContain("Full access");
  });

  test.each(["send-failure", "stream-failure"])("closes a failed turn: %s", async (text) => {
    const f = fixture();
    await f.init();
    await f.start();
    await f.turn(text);
    await f.settled();
    expect(f.deltas().filter((d) => d.kind === "turn.boundary")).toEqual([
      expect.objectContaining({
        status: "failed",
        error: { message: text === "send-failure" ? "Could not send" : "Connection dropped" },
      }),
    ]);
    expect(f.cancelled()).toBe(text === "stream-failure" ? 1 : 0);
  });

  test("returns the complete BB model-list response", async () => {
    const f = fixture();
    await f.init();
    const response = await f.request("model/list", { providerOptions: { profile: "personal" } });
    expect(response.result).toMatchObject({
      models: [expect.objectContaining({ displayName: "Test" })],
      selectedOnlyModels: [],
    });
  });
});

test("tool event order and usage follow BB's delta grammar", () => {
  const deltas: unknown[] = [];
  const events = new RunEvents((batch) => deltas.push(...batch));
  events.accept({
    type: "tool_call",
    agent_id: "agent",
    run_id: "run",
    call_id: "tool",
    name: "shell",
    status: "completed",
    result: { stdout: "ok" },
  });
  events.finish({
    id: "run",
    status: "finished",
    result: "Done",
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      totalTokens: 20,
    },
  });
  const parsed = deltas.map((delta) => threadDeltaSchema.parse(delta));
  expect(parsed.map((delta) => delta.kind)).toEqual([
    "item.open",
    "item.close",
    "item.textDelta",
    "usage",
    "item.textClose",
  ]);
  expect(parsed.find((delta) => delta.kind === "usage")).toMatchObject({
    total: { totalTokens: 20, inputTokens: 15, cachedInputTokens: 3 },
  });
});

test("tool values retain JSON data and bound oversized payloads", () => {
  expect(boundedValue(undefined)).toBeUndefined();
  expect(boundedValue({ stdout: "ok", count: 1, missing: null })).toEqual({
    stdout: "ok",
    count: 1,
    missing: null,
  });
  expect(boundedValue("x".repeat(50_000))).toHaveLength(48_000 + "… [truncated]".length);
  const events = new RunEvents(() => {});
  expect(() =>
    events.accept({
      type: "tool_call",
      agent_id: "agent",
      run_id: "run",
      call_id: "tool",
      name: "shell",
      status: "completed",
      result: { invalid: 1n },
    }),
  ).toThrow();
});

test("normalizes and redacts foreign errors before reporting them", () => {
  expect(safeMessage(new Error("crsr_secret Bearer token"))).toBe("[redacted] Bearer [redacted]");
  expect(safeMessage("crsr_secret")).toBe("[redacted]");
  expect(safeMessage(null)).toBe("null");
  expect(safeMessage("x".repeat(3000))).toHaveLength(2000);
});

test.each([
  ["cancelled", "interrupted"],
  ["error", "failed"],
  ["finished", "completed"],
] as const)("maps run status %s to %s", (status, expected) => {
  expect(runStatus(status)).toBe(expected);
});

test("credential errors remain readable", () => {
  expect(new SdkError({ message: "Missing key" }).message).toBe("Missing key");
});

test("text item identities stay distinct across turns", () => {
  const deltas: unknown[] = [];

  for (let turn = 0; turn < 2; turn++)
    new RunEvents((batch) => deltas.push(...batch)).append("Hello", "agentMessage");

  const keys = deltas.map(
    (d) => z.object({ key: z.object({ providerItemId: z.string() }) }).parse(d).key.providerItemId,
  );

  expect(new Set(keys).size).toBe(2);
});

const controlledCatalog: SDKModel[] = [
  {
    id: "controlled",
    displayName: "Controlled",
    variants: [false, true].flatMap((fast) =>
      ["none", "low", "high"].map((reasoning) => ({
        displayName: "Controlled",
        params: [
          { id: "fast", value: String(fast) },
          { id: "reasoning", value: reasoning },
        ],
      })),
    ),
  },
];

test("applies reasoning and speed on create, resume, and subsequent sends", async () => {
  const f = fixture(controlledCatalog);
  const [model] = modelCatalog(controlledCatalog);

  const execution = {
    model: model.model,
    reasoningLevel: "high",
    serviceTier: "fast",
  } satisfies Partial<TurnInput["options"]>;

  await f.init();
  expect((await f.start({ options: { ...options, ...execution } })).error).toBeUndefined();

  const fastHigh = {
    id: "controlled",
    params: [
      { id: "fast", value: "true" },
      { id: "reasoning", value: "high" },
    ],
  };

  expect(f.created[0].model).toEqual(fastHigh);
  expect((await f.turn("hello", execution)).error).toBeUndefined();
  await f.settled();
  expect(f.sent[0].options?.model).toEqual(fastHigh);
  await f.request("thread/stop", {
    threadId: "thread",
    providerThreadId: "agent-1",
    activeTurnId: null,
    intent: "release",
  });
  expect(
    (
      await f.request("thread/resume", {
        threadId: "thread",
        providerThreadId: "agent-1",
        cwd: "/tmp",
        instructionMode: "append",
        options: { ...options, ...execution },
      })
    ).error,
  ).toBeUndefined();
  expect(f.resumedOptions[0].model).toEqual(fastHigh);
  f.messages.splice(0);
  await f.turn("hello again", { ...execution, reasoningLevel: "low", serviceTier: "default" });
  await f.settled();
  expect(f.sent[1].options?.model).toEqual({
    id: "controlled",
    params: [
      { id: "fast", value: "false" },
      { id: "reasoning", value: "low" },
    ],
  });
});

describe("cloud bridge", () => {
  const stop = {
    threadId: "thread",
    providerThreadId: "bc-1",
    activeTurnId: null,
    intent: "release",
  };

  test("uses a pinned remote repository, preserves local secrets, and emits native run text", async () => {
    const f = fixture(undefined, true);
    const before = process.env.BB_CLOUD_TEST_SECRET;
    await f.init();
    expect(
      (
        await f.start({
          options: { ...f.executionOptions, envVars: { BB_CLOUD_TEST_SECRET: "local-only" } },
          dynamicTools: [
            { name: "testTool", description: "local", inputSchema: { type: "object" } },
          ],
        })
      ).error,
    ).toBeUndefined();
    expect(process.env.BB_CLOUD_TEST_SECRET).toBe(before);
    expect(f.created[0]).toMatchObject({
      cloud: {
        repos: [{ url: "https://github.com/example/repo", startingRef: "a".repeat(40) }],
        autoCreatePR: false,
        workOnCurrentBranch: false,
      },
    });
    expect(f.created[0].local).toBeUndefined();
    expect(f.created[0].cloud?.envVars).toBeUndefined();
    await f.turn("hello");
    await f.settled();
    expect(f.sent[0].options?.local).toBeUndefined();
    expect(f.sent[0].text).toContain("bb_cloud_runtime");

    const assembled = experimental_assembleCapturedThreadEvents(
      z.array(z.record(z.string(), z.unknown())).parse(f.messages),
      "cursor-cloud",
    );

    expect(assembled).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({ type: "agentMessage", text: "Hello" }),
      }),
    );
    expect(f.deltas()).toContainEqual(
      expect.objectContaining({
        kind: "item.textDelta",
        providerTurnId: "run-1",
        text: expect.stringContaining("https://cursor.com/agents/bc-1"),
      }),
    );
    await f.request("thread/stop", stop);
    expect(
      (
        await f.request("thread/resume", {
          threadId: "thread",
          providerThreadId: "bc-1",
          cwd: "/changed-checkout",
          instructionMode: "append",
          options: f.executionOptions,
        })
      ).error,
    ).toBeUndefined();
    expect(f.resumed).toEqual(["bc-1"]);
    expect(f.sourceCalls()).toBe(1);
    expect(f.resumedOptions[0].local).toBeUndefined();
  });

  test.each(["release", "shutdown"])("detaches a running cloud agent on %s", async (operation) => {
    const f = fixture(undefined, true);
    await f.init();
    await f.start();
    await f.turn("hold");
    await f.waitFor(() => f.deltas().some((d) => d.kind === "turn.open"));

    if (operation === "release") await f.request("thread/stop", stop);
    else f.bridge.onClose?.();
    await f.waitForDisposal();
    expect(f.cancelled()).toBe(0);
    expect(f.disposed()).toBe(1);
  });

  test("rejects an invalid cloud agent ID before contacting the SDK", async () => {
    const f = fixture(undefined, true);
    await f.init();

    const response = await f.request("thread/resume", {
      threadId: "thread",
      providerThreadId: "bc-../invalid",
      cwd: "/tmp",
      instructionMode: "append",
      options: f.executionOptions,
    });

    expect(response.error?.message).toBe("Invalid Cursor Cloud agent ID.");
    expect(f.created).toHaveLength(0);
    expect(f.resumed).toHaveLength(0);
  });

  test("explicit stop cancels cloud work and releases the handle", async () => {
    const f = fixture(undefined, true);
    await f.init();
    await f.start();
    await f.turn("hold");
    await f.waitFor(() => f.deltas().some((d) => d.kind === "turn.open"));
    await f.request("thread/stop", { ...stop, intent: "interrupt" });
    await f.settled();
    expect(f.cancelled()).toBe(1);
    expect(f.disposed()).toBe(1);
  });

  test("refuses a duplicate follow-up when the remote run is active", async () => {
    const f = fixture(undefined, true);
    await f.init();
    await f.start();
    await f.turn("hello");
    await f.settled();
    await f.request("thread/stop", stop);
    f.remoteStatus("running");

    const result = await f.request("thread/resume", {
      threadId: "thread",
      providerThreadId: "bc-1",
      cwd: "/tmp",
      instructionMode: "append",
      options: f.executionOptions,
    });

    expect(result.error?.message).toContain("still running");
    expect(f.created).toHaveLength(1);
    expect(f.resumed).toHaveLength(0);
  });

  test("retries a lazy launch with its original ID but never replaces established history", async () => {
    const f = fixture(undefined, true);
    await f.init();
    await f.start();
    await f.request("thread/stop", stop);
    f.remoteMissing();

    const resume = () =>
      f.request("thread/resume", {
        threadId: "thread",
        providerThreadId: "bc-1",
        cwd: "/tmp",
        instructionMode: "append",
        options: f.executionOptions,
      });

    expect((await resume()).error).toBeUndefined();
    expect(f.created[1].agentId).toBe("bc-1");
    expect(f.sourceCalls()).toBe(1);
    await f.turn("hello");
    await f.settled();
    await f.request("thread/stop", stop);
    expect((await resume()).error?.message).toContain("no longer available");
    expect(f.created).toHaveLength(2);
  });

  test.each<Partial<StartInput>>([{ disallowedTools: ["shell"] }, { instructionMode: "replace" }])(
    "rejects unsupported cloud policies: %j",
    async (extra) => {
      const f = fixture(undefined, true);
      await f.init();
      expect((await f.start(extra)).error?.message).toContain("cannot enforce");
      expect(f.created).toHaveLength(0);
    },
  );
});

test("stop during cloud launch cancels a run returned after the waiting fiber was released", async () => {
  const f = fixture(undefined, true);
  await f.init();
  await f.start();
  await f.turn("slow-send");
  await f.request("thread/stop", {
    threadId: "thread",
    providerThreadId: "bc-1",
    activeTurnId: null,
    intent: "interrupt",
  });
  f.completeSend();
  await f.waitForCancellation();
  await f.settled();
  expect(f.cancelled()).toBe(1);
  expect(f.deltas().filter((delta) => delta.kind === "turn.boundary")).toHaveLength(1);
});

test.each([false, true])(
  "resume retains its original runtime when the Cloud agents toggle changes (cloud=%s)",
  async (cloud) => {
    const f = fixture(undefined, cloud);
    const providerThreadId = cloud ? "bc-1" : "agent-1";
    await f.init();
    await f.start();
    await f.turn("hello");
    await f.settled();
    await f.request("thread/stop", {
      threadId: "thread",
      providerThreadId,
      activeTurnId: null,
      intent: "release",
    });

    const changedOptions = {
      ...f.executionOptions,
      providerOptions: { profile: "personal", runtime: cloud ? "local" : "cloud" },
    };

    const result = await f.request("thread/resume", {
      threadId: "thread",
      providerThreadId,
      cwd: "/tmp",
      instructionMode: "append",
      options: changedOptions,
    });

    expect(result.error).toBeUndefined();
    expect(f.resumed).toEqual([providerThreadId]);
    expect(Boolean(f.resumedOptions[0].local)).toBe(!cloud);
    f.messages.splice(0);
    await f.turn("hello again", changedOptions);
    await f.settled();
    expect(Boolean(f.sent[1].options?.local)).toBe(!cloud);
    expect(f.created).toHaveLength(1);
  },
);
