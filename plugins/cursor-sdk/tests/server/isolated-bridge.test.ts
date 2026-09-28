import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  experimental_createBridgeDeltaEventCollector,
  type ThreadEvent,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { createIsolatedBridge } from "../../src/server/isolated-bridge.js";
import { readDiagnostics } from "../../src/server/diagnostics.js";
import type { StartupPhase } from "../../src/shared/diagnostics.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const wireSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

type Wire = z.infer<typeof wireSchema>;

function fixture(stopTimeoutMs?: number, startupTimeouts?: Partial<Record<StartupPhase, number>>) {
  const dir = mkdtempSync(join(tmpdir(), "cursor-isolation-"));
  const modulePath = join(dir, "fake-host.mjs");
  // Exercise actual Node child processes, IPC, inherited environment and
  // colliding SDK callback ids without invoking a paid model.
  writeFileSync(
    modulePath,
    `
    export function createSdkBridge(deps, write) {
      let threadId;
      const send = message => write(JSON.stringify({ jsonrpc: "2.0", ...message }));
      return {
        start() {},
        handleLine(line) {
          const m = JSON.parse(line);
          if (!m.method) { send({ method: "callback-result", params: { threadId, value: m.result } }); return; }
          if (m.method === "thread/resume" && m.params.options?.envVars?.BB_ISOLATION_TEST === "resume-fails") {
            send({ id: m.id, error: { message: "Saved checkpoint is unavailable" } }); return;
          }
          if (m.method === "thread/start" || m.method === "thread/resume" || m.method === "thread/fork") {
            threadId = m.params.threadId;
            Object.assign(process.env, m.params.options.envVars);
            if (process.env.BB_ISOLATION_TEST === "hang-catalog") {
              deps.phase(threadId, { phase: "model-catalog", state: "started" });
              send({ method: "test/ready", params: { pid: process.pid } });
              return;
            }
            send({ method: "thread/identity", params: { threadId, providerThreadId: m.params.providerThreadId ?? "agent-" + threadId } });
          }
          if (m.method === "turn/start") {
            if (!threadId) { send({ id: m.id, error: { message: "Session not restored" } }); return; }
            if (process.env.BB_ISOLATION_TEST === "steady-run") {
              deps.phase(threadId, { phase: "run-start", state: "succeeded" });
              send({ method: "thread/delta", params: { threadId, deltas: [
                { kind: "turn.open", providerTurnId: "turn-a" },
                { kind: "item.open", providerTurnId: "turn-a", key: { providerItemId: "shell-a" }, item: { type: "tool", tool: "shell", args: {} } },
              ] } });
              send({ id: m.id, result: { accepted: true } });
              return;
            }
            if (process.env.BB_ISOLATION_TEST === "hang-run") {
              deps.phase(threadId, { phase: "run-start", state: "started" });
              send({ id: m.id, result: { accepted: true } });
              return;
            }
            send({ id: "tool-1", method: "item/tool/call", params: { threadId } });
          }
          if (m.method === "crash") process.exit(1);
          if (m.method === "thread/stop" && process.env.BB_ISOLATION_TEST === "hang-stop") return;
          send({ id: m.id, result: { pid: process.pid, value: process.env.BB_ISOLATION_TEST } });
          if (m.params?.fail) send({ method: "thread/delta", params: { threadId, deltas: [{ kind: "turn.boundary", status: "failed" }] } });
        },
        onClose() {},
      };
    }
  `,
  );
  const messages: Wire[] = [];
  const collector = experimental_createBridgeDeltaEventCollector("cursor-sdk");
  const events: ThreadEvent[] = [];
  const waiters = new Set<() => void>();

  const bridge = createIsolatedBridge(
    pathToFileURL(modulePath).href,
    (line) => {
      const message = wireSchema.parse(JSON.parse(line));
      messages.push(message);
      events.push(...collector.assembleMessage(message));

      for (const wake of waiters) wake();
    },
    undefined,
    stopTimeoutMs,
    startupTimeouts,
  );

  bridge.start?.({ pluginId: "cursor-sdk", dataDir: dir, tempDir: dir });
  cleanups.push(async () => {
    await bridge.onClose?.();
    rmSync(dir, { recursive: true, force: true });
  });
  let id = 0;

  const waitFor = (predicate: (message: Wire) => boolean): Promise<Wire> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(check);
        reject(new Error("Missing bridge reply"));
      }, 5000);

      const check = () => {
        const message = messages.find(predicate);

        if (message) {
          clearTimeout(timeout);
          waiters.delete(check);
          resolve(message);
        }
      };

      waiters.add(check);
      check();
    });

  const send = (message: Wire) => bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", ...message }));

  const request = (method: string, params: NonNullable<Wire["params"]>) => {
    const requestId = ++id;
    send({ id: requestId, method, params });

    return waitFor((message) => message.id === requestId);
  };

  return { request, send, waitFor, messages, dir, events };
}

async function initialize(f: ReturnType<typeof fixture>) {
  await f.request("initialize", { protocolVersion: 2, client: { name: "test", version: "1" } });
}

test("a stalled startup reports its phase only after the child exits, then allows a new session", async () => {
  const f = fixture(undefined, { "model-catalog": 20 });
  await initialize(f);

  const pending = f.request("thread/start", {
    threadId: "a",
    options: { envVars: { BB_ISOLATION_TEST: "hang-catalog" } },
  });

  const ready = await f.waitFor((message) => message.method === "test/ready");
  const pid = z.object({ pid: z.number() }).parse(ready.params).pid;
  expect((await pending).error?.message).toContain("model-catalog timed out");
  expect(() => process.kill(pid, 0)).toThrow();
  expect(readDiagnostics(f.dir, "a")).toContainEqual(
    expect.objectContaining({ phase: "model-catalog", state: "timed-out" }),
  );
  expect(f.messages.some((message) => message.method === "cursor/phase")).toBe(false);
  expect(
    (
      await f.request("thread/start", {
        threadId: "a",
        options: { envVars: { BB_ISOLATION_TEST: "repaired" } },
      })
    ).error,
  ).toBeUndefined();
});

test("a stalled run handle settles the accepted turn as failed without replaying it", async () => {
  const f = fixture(undefined, { "run-start": 20 });
  await initialize(f);
  await f.request("thread/start", {
    threadId: "a",
    options: { envVars: { BB_ISOLATION_TEST: "hang-run" } },
  });
  expect((await f.request("turn/start", { threadId: "a" })).error).toBeUndefined();
  const boundary = await f.waitFor((message) => message.method === "thread/delta");
  expect(boundary.params).toMatchObject({
    deltas: [
      {
        kind: "turn.boundary",
        status: "failed",
        error: { message: expect.stringContaining("run-start timed out") },
      },
    ],
  });
  expect(readDiagnostics(f.dir, "a")).toContainEqual(
    expect.objectContaining({ phase: "run-start", state: "timed-out" }),
  );
});

test("a pending host tool can outlive run startup's deadline", async () => {
  const f = fixture(undefined, { "run-start": 20, "model-catalog": 60 });
  await initialize(f);
  await f.request("thread/start", { threadId: "a", options: { envVars: {} } });
  await f.request("turn/start", { threadId: "a" });
  const callback = await f.waitFor((message) => message.method === "item/tool/call");

  // Wait for another child's longer deadline, without relying on a sleep.
  const blocked = await f.request("thread/start", {
    threadId: "b",
    options: { envVars: { BB_ISOLATION_TEST: "hang-catalog" } },
  });

  expect(blocked.error?.message).toContain("model-catalog timed out");
  expect(readDiagnostics(f.dir, "a").some((event) => event.state === "timed-out")).toBe(false);
  f.send({ id: callback.id, result: { accepted: true } });
  expect(
    (await f.waitFor((message) => message.method === "callback-result")).params?.threadId,
  ).toBe("a");
});

test("stopping during construction settles the outstanding start request", async () => {
  const f = fixture();
  await initialize(f);

  const pending = f.request("thread/start", {
    threadId: "a",
    options: { envVars: { BB_ISOLATION_TEST: "hang-catalog" } },
  });

  await f.waitFor((message) => message.method === "test/ready");
  expect((await f.request("thread/stop", { threadId: "a" })).error).toBeUndefined();
  expect((await pending).error?.message).toContain("closed before this request finished");
});

test("concurrent sessions retain distinct environments through later turns and resume", async () => {
  const before = process.env.BB_ISOLATION_TEST;
  const f = fixture();
  await initialize(f);

  const start = (threadId: string, value: string, method = "thread/start") =>
    f.request(method, {
      threadId,
      options: { envVars: { BB_ISOLATION_TEST: value } },
    });

  const [a, b] = await Promise.all([start("a", "first"), start("b", "second")]);
  const result = z.object({ pid: z.number(), value: z.string() });
  expect(result.parse(a.result).pid).not.toBe(result.parse(b.result).pid);
  expect(result.parse((await f.request("inspect", { threadId: "a" })).result).value).toBe("first");
  expect(result.parse((await f.request("inspect", { threadId: "b" })).result).value).toBe("second");
  await f.request("thread/stop", { threadId: "a" });
  const resumed = result.parse((await start("a", "resumed", "thread/resume")).result);
  expect(resumed.pid).not.toBe(result.parse(a.result).pid);
  expect(resumed.value).toBe("resumed");
  expect(result.parse((await f.request("inspect", { threadId: "b" })).result).value).toBe("second");
  expect(process.env.BB_ISOLATION_TEST).toBe(before);
});

test("routes identical child tool-call ids back to the correct sessions", async () => {
  const f = fixture();
  await initialize(f);

  for (const threadId of ["a", "b"]) {
    await f.request("thread/start", { threadId, options: { envVars: {} } });
    await f.request("turn/start", { threadId });
  }

  const a = await f.waitFor((m) => m.method === "item/tool/call" && m.params?.threadId === "a");
  const b = await f.waitFor((m) => m.method === "item/tool/call" && m.params?.threadId === "b");
  expect(a.id).not.toBe(b.id);
  f.send({ id: b.id, result: "second" });
  f.send({ id: a.id, result: "first" });
  expect(
    (await f.waitFor((m) => m.method === "callback-result" && m.params?.threadId === "a")).params
      ?.value,
  ).toBe("first");
  expect(
    (await f.waitFor((m) => m.method === "callback-result" && m.params?.threadId === "b")).params
      ?.value,
  ).toBe("second");

  const fork = await f.request("thread/fork", {
    threadId: "fork",
    sourceProviderThreadId: "agent-a",
  });

  expect(fork.error?.message).toContain("finish before forking");
});

test("a crashed child fails pending requests without stopping other sessions", async () => {
  const f = fixture();
  await initialize(f);

  for (const threadId of ["a", "b"])
    await f.request("thread/start", { threadId, options: { envVars: {} } });
  expect((await f.request("crash", { threadId: "a" })).error?.message).toContain(
    "exited unexpectedly",
  );
  expect((await f.request("inspect", { threadId: "b" })).error).toBeUndefined();
});

test("the next user message restores a crashed child's saved identity and environment", async () => {
  const f = fixture();
  await initialize(f);

  const original = await f.request("thread/start", {
    threadId: "a",
    options: { envVars: { BB_ISOLATION_TEST: "original" } },
  });

  await f.request("turn/start", { threadId: "a" });
  await f.request("crash", { threadId: "a" });
  const recovered = await f.request("turn/start", { threadId: "a", providerThreadId: "agent-a" });
  expect(recovered.error).toBeUndefined();
  expect(recovered.result).toMatchObject({ value: "original" });
  expect(recovered.result).not.toEqual(original.result);
  expect(f.messages.filter((m) => m.method === "item/tool/call")).toHaveLength(2);
  expect(
    f.messages.filter((m) => m.method === "thread/identity").map((m) => m.params?.providerThreadId),
  ).toEqual(["agent-a", "agent-a"]);
});

test("an unsolicited exit during a tool settles the turn, records the signal and rejects stale steering without launching an empty session", async () => {
  const f = fixture();
  await initialize(f);

  const original = await f.request("thread/start", {
    threadId: "a",
    options: { envVars: { BB_ISOLATION_TEST: "steady-run" } },
  });

  await f.request("turn/start", { threadId: "a" });
  const pid = z.object({ pid: z.number() }).parse(original.result).pid;
  process.kill(pid, "SIGKILL");

  const boundary = await f.waitFor(
    (message) =>
      message.method === "thread/delta" && JSON.stringify(message.params).includes("turn.boundary"),
  );

  expect(boundary.params).toMatchObject({
    deltas: [
      expect.objectContaining({ kind: "item.close", status: "failed", providerTurnId: "turn-a" }),
      expect.objectContaining({
        kind: "turn.boundary",
        status: "failed",
        providerTurnId: "turn-a",
      }),
    ],
  });
  const started = f.events.find((event) => event.type === "turn/started");
  const completed = f.events.find((event) => event.type === "turn/completed");
  expect(started).toBeDefined();
  expect(completed).toMatchObject({ status: "failed", scope: started?.scope });
  expect(f.events.find((event) => event.type === "item/completed")).toMatchObject({
    scope: started?.scope,
    item: { type: "toolCall", tool: "shell", status: "failed" },
  });
  expect(readDiagnostics(f.dir, "a")).toContainEqual(
    expect.objectContaining({
      phase: "session-process",
      state: "process-exited",
      childPid: pid,
      exitCode: null,
      signal: "SIGKILL",
      reason: "unexpected-exit",
    }),
  );
  const before = readDiagnostics(f.dir, "a");

  const steer = await f.request("turn/steer", {
    threadId: "a",
    providerThreadId: "agent-a",
    expectedTurnId: "turn-a",
  });

  expect(steer.error).toMatchObject({ code: -32001 });
  expect(readDiagnostics(f.dir, "a")).toEqual(before);

  const resumed = await f.request("turn/start", { threadId: "a", providerThreadId: "agent-a" });
  expect(resumed.error).toBeUndefined();
  expect(f.messages.filter((message) => message.method === "thread/identity")).toHaveLength(2);
});

test("a stale steer after a bridge restart settles the named turn without starting a child", async () => {
  const f = fixture();
  await initialize(f);

  const reply = await f.request("turn/steer", {
    threadId: "a",
    providerThreadId: "agent-a",
    expectedTurnId: "abandoned-turn",
  });

  expect(reply.error?.code).toBe(-32001);
  expect(f.messages.find((message) => message.method === "thread/delta")?.params).toMatchObject({
    deltas: [
      {
        kind: "turn.boundary",
        providerTurnId: "abandoned-turn",
        status: "failed",
        error: expect.any(Object),
      },
    ],
  });
  expect(readDiagnostics(f.dir, "a")).toEqual([]);
});

test("failed local turns retire their child before restoring the next message", async () => {
  const f = fixture();
  await initialize(f);
  const original = await f.request("thread/start", { threadId: "a", options: { envVars: {} } });
  await f.request("turn/start", { threadId: "a", fail: true });
  await f.waitFor((m) => m.method === "thread/delta");
  const recovered = await f.request("turn/start", { threadId: "a", providerThreadId: "agent-a" });
  expect(recovered.error).toBeUndefined();
  expect(recovered.result).not.toEqual(original.result);
  const pid = z.object({ pid: z.number() }).parse(original.result).pid;
  expect(() => process.kill(pid, 0)).toThrow();
});

test("Stop retires a hung local child and allows the saved conversation to resume", async () => {
  const f = fixture(20);
  await initialize(f);

  const original = await f.request("thread/start", {
    threadId: "a",
    options: { envVars: { BB_ISOLATION_TEST: "hang-stop" } },
  });

  await f.request("turn/start", { threadId: "a" });

  const stopped = await f.request("thread/stop", {
    threadId: "a",
    providerThreadId: "agent-a",
    intent: "interrupt",
  });

  expect(stopped.error).toBeUndefined();
  const pid = z.object({ pid: z.number() }).parse(original.result).pid;
  expect(() => process.kill(pid, 0)).toThrow();
  expect(f.messages.filter((m) => m.method === "thread/delta")).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({
        deltas: [expect.objectContaining({ status: "interrupted" })],
      }),
    }),
  ]);
  const recovered = await f.request("turn/start", { threadId: "a", providerThreadId: "agent-a" });
  expect(recovered.error).toBeUndefined();
});

test("cloud failures keep their runtime attached rather than applying local recovery", async () => {
  const f = fixture();
  await initialize(f);

  const original = await f.request("thread/resume", {
    threadId: "a",
    providerThreadId: "bc-a",
    options: { envVars: {} },
  });

  await f.request("turn/start", { threadId: "a", fail: true });
  await f.waitFor((m) => m.method === "thread/delta");
  expect((await f.request("inspect", { threadId: "a" })).result).toEqual(original.result);
});

test("failed automatic resume reports its cause without submitting the new prompt", async () => {
  const f = fixture();
  await initialize(f);
  await f.request("thread/start", {
    threadId: "a",
    options: { envVars: { BB_ISOLATION_TEST: "resume-fails" } },
  });
  await f.request("crash", { threadId: "a" });
  const reply = await f.request("turn/start", { threadId: "a", providerThreadId: "agent-a" });
  expect(reply.error?.message).toBe("Saved checkpoint is unavailable");
  expect(f.messages.filter((m) => m.method === "item/tool/call")).toHaveLength(0);
  expect(
    (
      await f.request("thread/resume", {
        threadId: "a",
        providerThreadId: "agent-a",
        options: { envVars: {} },
      })
    ).error,
  ).toBeUndefined();
});

test("a lost cloud child cannot report successful remote cancellation", async () => {
  const f = fixture(20);
  await initialize(f);
  await f.request("thread/resume", {
    threadId: "a",
    providerThreadId: "bc-a",
    options: { envVars: {} },
  });
  await f.request("crash", { threadId: "a" });

  const stopped = await f.request("thread/stop", {
    threadId: "a",
    providerThreadId: "bc-a",
    intent: "interrupt",
  });

  expect(stopped.error?.message).toContain("cancellation cannot be confirmed");
  expect(
    (await f.request("thread/stop", { threadId: "a", providerThreadId: "bc-a", intent: "release" }))
      .error,
  ).toBeUndefined();
});

test("a turn submitted immediately before a fork already counts as active", async () => {
  const f = fixture();
  await initialize(f);
  await f.request("thread/start", { threadId: "a", options: { envVars: {} } });
  f.send({ id: 500, method: "turn/start", params: { threadId: "a" } });

  const fork = await f.request("thread/fork", {
    threadId: "child",
    sourceProviderThreadId: "agent-a",
  });

  expect(fork.error?.message).toContain("finish before forking");
});
