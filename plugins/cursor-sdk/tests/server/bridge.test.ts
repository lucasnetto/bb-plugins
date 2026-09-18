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
  type SteerAckOutcome,
} from "@cursor/sdk";
import {
  experimental_runBridgeConformance,
  experimental_formatConformanceReport,
  experimental_assembleCapturedThreadEvents,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  threadDeltaSchema,
  threadStartParamsSchema,
  threadForkParamsSchema,
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
  let steerOutcome: SteerAckOutcome = "complete_delivered";
  let steerEnabled = true;
  let steerFailure = false;
  let releaseRun: (() => void) | undefined;
  let acknowledgeSteer: (() => void) | undefined;
  let deferSteer = false;
  const steered: string[] = [];
  let cancelled = 0;
  let disposed = 0;
  const disposal = Deferred.makeUnsafe<void>();
  const cancellation = Deferred.makeUnsafe<void>();
  let sequence = 0;
  const failures: Partial<Record<"models" | "send" | "stream" | "result", SdkError>> = {};

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

        if (failures.send) throw failures.send;

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
          releaseRun = resolve;
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
            if (failures.stream) throw failures.stream;

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
            if (failures.result)
              return {
                id,
                status: "error",
                error: { message: failures.result.message, code: failures.result.code },
              };

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

        if (steerEnabled)
          run.steer = async (message) => {
            steered.push(message);

            if (steerFailure) throw new Error("Steer transport failed");

            if (deferSteer)
              await new Promise<void>((resolve) => {
                acknowledgeSteer = resolve;
              });

            return steerOutcome;
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

        const agentId =
          value.agentId ?? (value.cloud ? `bc-${created.length}` : `agent-${created.length}`);

        if (value.local?.store) {
          await value.local.store.checkpoints.create({
            agentId,
            blobId: "root",
            data: new Uint8Array([1]),
          });
          await value.local.store.agents.create({
            agent: {
              agentId,
              cwd: value.local.cwd ?? "/tmp",
              status: "idle",
              activeRunId: null,
              createdAt: 1,
              updatedAt: 1,
              latestCheckpoint: { schemaVersion: 1, rootBlobId: "root" },
            },
          });
        }

        return makeAgent(agentId);
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
          if (failures.models) throw failures.models;

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
    failures,
    dataDir,
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
    steered,
    releaseRun: () => releaseRun?.(),
    acknowledgeSteer: () => acknowledgeSteer?.(),
    steerBehavior: (
      outcome: SteerAckOutcome,
      enabled = true,
      deferred = false,
      failure = false,
    ) => {
      steerOutcome = outcome;
      steerEnabled = enabled;
      deferSteer = deferred;
      steerFailure = failure;
    },
    steer: (
      input: TurnInput["input"] = [{ type: "text", text: "Skip admin", mentions: [] }],
      expectedTurnId = "run-1",
    ) =>
      request("turn/steer", {
        threadId: "thread",
        providerThreadId,
        expectedTurnId,
        clientRequestId: "creq_steering23",
        input,
        options: executionOptions,
      }),
    running: () => waitFor(() => deltas().some((d) => d.kind === "turn.open")),
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

  test("loads local MCP settings on start and resume", async () => {
    const f = fixture();
    await f.init();
    await f.start();
    expect(f.created[0]?.local?.settingSources).toEqual(["project", "user", "plugins"]);
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
    expect(f.resumedOptions[0]?.local?.settingSources).toEqual(["project", "user", "plugins"]);
  });

  test("does not forward local setting sources to cloud", async () => {
    const f = fixture(undefined, true);
    await f.init();
    await f.start();
    expect(f.created[0]?.local).toBeUndefined();
  });

  test.each(["send", "stream"] as const)(
    "preserves structured %s failures and settles once without replay",
    async (stage) => {
      const f = fixture();
      await f.init();
      await f.start();
      f.failures[stage] = new SdkError({
        message: "Limited crsr_secret",
        code: "quota",
        status: 429,
        isRetryable: true,
        requestId: "req-42",
      });
      await f.turn("hello");
      await f.settled();
      expect(f.deltas().filter((d) => d.kind === "provider.error")).toEqual([
        expect.objectContaining({
          message: "Limited [redacted]",
          errorInfo: { category: "rate-limit", httpStatusCode: 429, providerCode: "quota" },
          willRetry: false,
          settlesTurn: false,
          detail: JSON.stringify({ isRetryable: true, requestId: "req-42" }),
        }),
      ]);
      expect(f.messages).toContainEqual({
        jsonrpc: "2.0",
        method: "provider/recovery",
        params: {
          threadId: "thread",
          kind: "rateLimited",
          message: "Limited [redacted]",
          retryable: false,
        },
      });
      expect(f.deltas().filter((d) => d.kind === "turn.boundary")).toHaveLength(1);
      expect(f.sent).toHaveLength(1);
    },
  );

  test("preserves terminal result error codes without guessing a recovery action", async () => {
    const f = fixture();
    await f.init();
    await f.start();
    f.failures.result = new SdkError({ message: "Stopped", code: "vendor_specific" });
    await f.turn("hello");
    await f.settled();
    expect(f.deltas().find((d) => d.kind === "provider.error")).toMatchObject({
      errorInfo: { category: "unknown", providerCode: "vendor_specific", httpStatusCode: null },
    });
    expect(
      f.messages.some(
        (m) => z.object({ method: z.literal("provider/recovery") }).safeParse(m).success,
      ),
    ).toBe(false);
  });

  test("returns an authentication recovery hint for a rejected session start", async () => {
    const f = fixture();
    await f.init();
    f.failures.models = new SdkError({ message: "Expired", status: 401, code: "auth" });
    const response = await f.start();
    expect(f.messages).toContainEqual({
      jsonrpc: "2.0",
      id: response.id,
      error: {
        code: -32603,
        message: "Expired",
        data: { recovery: { kind: "authRequired", message: "Expired", retryable: false } },
      },
    });
    expect(f.created).toHaveLength(0);
    expect(f.deltas()).toEqual([]);
  });

  test("injects a steer into the active run without starting or cancelling a run", async () => {
    const f = fixture();
    expect((await f.init()).result).toMatchObject({ capabilities: { steerMode: "inject" } });
    await f.start();
    await f.turn("hold");
    await f.running();
    expect((await f.steer()).result).toEqual({ accepted: true });
    expect(f.steered).toEqual(["Skip admin"]);
    expect(f.sent).toHaveLength(1);
    expect(f.cancelled()).toBe(0);
    expect(f.deltas().filter((d) => d.kind === "input.accepted")).toEqual([
      { kind: "input.accepted", clientRequestId: "creq_abcdefghij", providerTurnId: "run-1" },
      { kind: "input.accepted", clientRequestId: "creq_steering23", providerTurnId: "run-1" },
    ]);
    f.releaseRun();
    await f.settled();
    expect(f.deltas().filter((d) => d.kind === "turn.boundary")).toHaveLength(1);
  });

  test.each(["declined", "missing", "cloud"])(
    "delivers %s steering as one follow-up after the run",
    async (mode) => {
      const f = fixture(undefined, mode === "cloud");
      f.steerBehavior("revert_to_followup", mode !== "missing");
      await f.init();
      await f.start();
      await f.turn("hold");
      await f.running();
      expect((await f.steer()).error).toBeUndefined();
      expect(f.sent).toHaveLength(1);
      expect(f.deltas().filter((d) => d.kind === "input.accepted")).toHaveLength(1);
      f.releaseRun();
      await f.settled();
      expect(f.sent).toHaveLength(2);
      expect(f.sent[1]?.text).toContain("Skip admin");
      expect(f.steered).toHaveLength(mode === "declined" ? 1 : 0);
      expect(f.deltas().filter((d) => d.kind === "input.accepted")).toHaveLength(2);
      expect(f.deltas().filter((d) => d.kind === "turn.open")).toHaveLength(1);
      expect(f.deltas().filter((d) => d.kind === "turn.boundary")).toHaveLength(1);
    },
  );

  test("preserves attachments in a follow-up instead of silently dropping them", async () => {
    const f = fixture();
    await f.init();
    await f.start();
    await f.turn("hold");
    await f.running();
    expect(
      (
        await f.steer([
          { type: "text", text: "Use this file", mentions: [] },
          { type: "localFile", path: "/tmp/instructions.md" },
        ])
      ).error,
    ).toBeUndefined();
    expect(f.steered).toEqual([]);
    f.releaseRun();
    await f.settled();
    expect(f.sent[1]?.text).toBe("Use this file\n\nAttached file: /tmp/instructions.md");
  });

  test("does not resend a steer when transport failure leaves delivery uncertain", async () => {
    const f = fixture();
    f.steerBehavior("complete_delivered", true, false, true);
    await f.init();
    await f.start();
    await f.turn("hold");
    await f.running();
    expect((await f.steer()).result).toEqual({ accepted: true });
    await f.waitFor(() => f.deltas().some((d) => d.kind === "provider.error"));
    expect(f.deltas()).toContainEqual(
      expect.objectContaining({
        kind: "provider.error",
        message: "Cursor could not confirm steering delivery: Steer transport failed",
        settlesTurn: false,
        willRetry: false,
      }),
    );
    expect(f.deltas().some((d) => d.kind === "turn.boundary")).toBe(false);
    f.releaseRun();
    await f.settled();
    expect(f.sent).toHaveLength(1);
    expect(f.cancelled()).toBe(0);
    expect(f.deltas().filter((d) => d.kind === "input.accepted")).toHaveLength(1);
  });

  test("does not execute a queued follow-up after an explicit stop", async () => {
    const f = fixture();
    f.steerBehavior("revert_to_followup");
    await f.init();
    await f.start();
    await f.turn("hold");
    await f.running();
    await f.steer();
    await f.request("thread/stop", {
      threadId: "thread",
      providerThreadId: "agent-1",
      intent: "interrupt",
      activeTurnId: "run-1",
    });
    await f.settled();
    expect(f.sent).toHaveLength(1);
    expect(f.deltas().filter((d) => d.kind === "input.accepted")).toHaveLength(1);
  });

  test("rejects a stale target without sending input or stopping the live turn", async () => {
    const f = fixture();
    await f.init();
    await f.start();
    await f.turn("hold");
    await f.running();
    expect((await f.steer(undefined, "old-run")).error?.code).toBe(-32001);
    expect(f.steered).toEqual([]);
    expect(f.sent).toHaveLength(1);
    expect(f.deltas().some((d) => d.kind === "turn.boundary")).toBe(false);
  });

  test.each(["complete_delivered", "revert_to_followup"] as const)(
    "keeps the turn open for a late %s acknowledgement",
    async (outcome) => {
      const f = fixture();
      f.steerBehavior(outcome, true, true);
      await f.init();
      await f.start();
      await f.turn("hold");
      await f.running();
      const steering = f.steer();
      // The bridge starts the SDK call synchronously before yielding its acknowledgement.
      expect(f.steered).toEqual(["Skip admin"]);
      // Receipt must not wait for consumption: that may take longer than BB's
      // RPC deadline when the agent is running a tool.
      expect((await steering).result).toEqual({ accepted: true });
      expect(f.deltas().filter((d) => d.kind === "input.accepted")).toHaveLength(1);
      f.releaseRun();
      await f.waitFor(() => f.deltas().some((d) => d.kind === "item.textClose"));
      expect(f.deltas().some((d) => d.kind === "turn.boundary")).toBe(false);
      f.acknowledgeSteer();
      await steering;
      await f.settled();
      const deltas = f.deltas();
      expect(
        deltas.findIndex(
          (d) => d.kind === "input.accepted" && d.clientRequestId === "creq_steering23",
        ),
      ).toBeLessThan(deltas.findIndex((d) => d.kind === "turn.boundary"));
      expect(f.sent).toHaveLength(outcome === "complete_delivered" ? 1 : 2);
    },
  );

  test.each(["complete_delivered", "revert_to_followup"] as const)(
    "stops with an unacknowledged steer and ignores late %s delivery",
    async (outcome) => {
      const f = fixture();
      f.steerBehavior(outcome, true, true);
      await f.init();
      await f.start();
      await f.turn("hold");
      await f.running();
      expect((await f.steer()).result).toEqual({ accepted: true });
      await f.request("thread/stop", {
        threadId: "thread",
        providerThreadId: "agent-1",
        intent: "interrupt",
        activeTurnId: "run-1",
      });
      await f.settled();
      f.acknowledgeSteer();
      // Starting another turn provides an async barrier and verifies recovery.
      expect(
        (
          await f.request("thread/resume", {
            threadId: "thread",
            providerThreadId: "agent-1",
            cwd: "/tmp",
            instructionMode: "append",
            options: f.executionOptions,
          })
        ).error,
      ).toBeUndefined();
      expect((await f.turn("hello")).error).toBeUndefined();
      await f.waitFor(() => f.deltas().filter((d) => d.kind === "turn.boundary").length === 2);
      expect(f.sent.map((message) => message.text)).toEqual(["hold", "hello"]);
      expect(
        f
          .deltas()
          .filter((d) => d.kind === "input.accepted" && d.clientRequestId === "creq_steering23"),
      ).toHaveLength(0);
    },
  );

  test("forks a persisted local conversation into the child workspace and resumes its new identity", async () => {
    const f = fixture();
    const store = new JsonlLocalAgentStore(join(f.dataDir, "conversations", "personal"));
    await store.checkpoints.create({
      agentId: "source",
      blobId: "root",
      data: new Uint8Array([1, 2, 3]),
    });
    await store.agents.create({
      agent: {
        agentId: "source",
        cwd: "/old",
        status: "idle",
        activeRunId: null,
        createdAt: 1,
        updatedAt: 1,
        latestCheckpoint: { schemaVersion: 1, rootBlobId: "root" },
      },
    });
    await f.init();

    const fork = await f.request("thread/fork", {
      threadId: "child",
      sourceProviderThreadId: "source",
      cwd: "/child",
      instructionMode: "replace",
      disallowedTools: ["Shell"],
      options: {
        ...options,
        instructions: "Child instructions",
        providerOptions: { profile: "personal", runtime: "cloud" },
      },
    } satisfies z.input<typeof threadForkParamsSchema>);

    expect(fork.error).toBeUndefined();
    const id = z.object({ providerThreadId: z.string() }).parse(fork.result).providerThreadId;
    expect(id).not.toBe("source");
    expect(f.resumed).toEqual([id]);
    expect(f.resumedOptions[0]).toMatchObject({
      local: { cwd: "/child" },
      disallowedTools: ["Shell"],
      systemPrompt: "Child instructions",
    });
    expect(f.messages).toContainEqual(
      expect.objectContaining({
        method: "thread/identity",
        params: { threadId: "child", providerThreadId: id },
      }),
    );
    expect(await store.agents.get({ agentId: "source" })).toMatchObject({
      cwd: "/old",
      updatedAt: 1,
    });
    await f.request("thread/stop", {
      threadId: "child",
      providerThreadId: id,
      activeTurnId: null,
      intent: "release",
    });
    await f.request("thread/resume", {
      threadId: "child",
      providerThreadId: id,
      cwd: "/child",
      instructionMode: "append",
      options,
    });
    expect(f.resumed).toEqual([id, id]);
  });

  test("rejects cloud and historical forks without creating a conversation", async () => {
    const f = fixture();
    await f.init();

    for (const source of [
      { sourceProviderThreadId: "bc-source" },
      { sourceProviderThreadId: "source", sourceProviderCheckpointId: "old" },
    ]) {
      const response = await f.request("thread/fork", {
        ...source,
        threadId: "child",
        cwd: "/tmp",
        instructionMode: "append",
        options,
      });

      expect(response.error?.message).toMatch(/Cloud|latest saved state/);
    }

    expect(f.created).toHaveLength(0);
    expect(f.resumed).toHaveLength(0);
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

test("follow-up runs retain result-only text and cumulative usage", () => {
  const deltas: z.infer<typeof threadDeltaSchema>[] = [];
  const events = new RunEvents((batch) => deltas.push(...batch));

  const usage = {
    inputTokens: 2,
    outputTokens: 3,
    totalTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  events.startRun();
  events.accept({
    type: "assistant",
    agent_id: "agent",
    run_id: "first",
    message: { role: "assistant", content: [{ type: "text", text: "First" }] },
  });
  events.accept({ type: "usage", agent_id: "agent", run_id: "first", usage });
  events.finish({ id: "first", status: "finished", result: "First", usage });
  events.startRun();
  events.finish({ id: "second", status: "finished", result: "Second", usage });
  expect(deltas.flatMap((d) => (d.kind === "item.textDelta" ? [d.text] : []))).toEqual([
    "First",
    "Second",
  ]);
  expect(deltas.filter((d) => d.kind === "usage").at(-1)).toMatchObject({
    total: { totalTokens: 10 },
  });
});

test("task milestones are bounded, deduplicated, and do not replace final text", () => {
  const deltas: z.infer<typeof threadDeltaSchema>[] = [];
  const events = new RunEvents((batch) => deltas.push(...batch));
  const base = { type: "task", agent_id: "agent", run_id: "run" } as const;
  events.startRun();
  events.accept(base);
  events.accept({ ...base, text: "  ", status: " " });
  events.accept({ ...base, status: "running", text: "Inspecting files" });
  events.accept({ ...base, status: "running", text: "Inspecting files" });
  events.accept({ ...base, status: "completed" });
  events.finish({ id: "run", status: "finished", result: "Final answer" });
  expect(deltas.flatMap((d) => (d.kind === "item.textDelta" ? [d.text] : []))).toEqual([
    "running: Inspecting files",
    "completed",
    "Final answer",
  ]);
  events.startRun();
  events.accept({ ...base, status: "completed" });
  events.accept({ ...base, text: "x".repeat(10000) });
  expect(deltas.filter((d) => d.kind === "item.textDelta").at(-1)?.text).toHaveLength(8000);
  expect(deltas.filter((d) => d.kind === "item.textDelta" && d.text === "completed")).toHaveLength(
    2,
  );

  for (const delta of deltas) expect(threadDeltaSchema.safeParse(delta).success).toBe(true);
});
