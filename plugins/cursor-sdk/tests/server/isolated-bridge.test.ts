import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { createIsolatedBridge } from "../../src/server/isolated-bridge.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const wireSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

type Wire = z.infer<typeof wireSchema>;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "cursor-isolation-"));
  const modulePath = join(dir, "fake-host.mjs");
  // Exercise actual Node child processes, IPC, inherited environment and
  // colliding SDK callback ids without invoking a paid model.
  writeFileSync(
    modulePath,
    `
    export function createSdkBridge(_, write) {
      let threadId;
      const send = message => write(JSON.stringify({ jsonrpc: "2.0", ...message }));
      return {
        start() {},
        handleLine(line) {
          const m = JSON.parse(line);
          if (!m.method) { send({ method: "callback-result", params: { threadId, value: m.result } }); return; }
          if (m.method === "thread/start" || m.method === "thread/resume" || m.method === "thread/fork") {
            threadId = m.params.threadId;
            Object.assign(process.env, m.params.options.envVars);
            send({ method: "thread/identity", params: { threadId, providerThreadId: "agent-" + threadId } });
          }
          if (m.method === "turn/start") {
            send({ id: "tool-1", method: "item/tool/call", params: { threadId } });
          }
          if (m.method === "crash") process.exit(1);
          send({ id: m.id, result: { pid: process.pid, value: process.env.BB_ISOLATION_TEST } });
        },
        onClose() {},
      };
    }
  `,
  );
  const messages: Wire[] = [];
  const waiters = new Set<() => void>();

  const bridge = createIsolatedBridge(pathToFileURL(modulePath).href, (line) => {
    messages.push(wireSchema.parse(JSON.parse(line)));

    for (const wake of waiters) wake();
  });

  bridge.start?.({ pluginId: "cursor-sdk", dataDir: dir, tempDir: dir });
  cleanups.push(() => {
    bridge.onClose?.();
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

  return { request, send, waitFor };
}

async function initialize(f: ReturnType<typeof fixture>) {
  await f.request("initialize", { protocolVersion: 2, client: { name: "test", version: "1" } });
}

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
