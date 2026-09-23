import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { createIsolatedBridge, type LaunchSession } from "../../src/server/isolated-bridge.js";

const wireSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
});

type Wire = z.infer<typeof wireSchema>;

const cleanups: Array<() => Promise<void>> = [];

beforeEach(() => vi.useFakeTimers());

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "cursor-idle-"));
  const messages: Wire[] = [];

  const children: Array<{
    received: Wire[];
    closing: boolean;
    delayExit: boolean;
    emit: (message: Wire) => void;
    exit: () => void;
  }> = [];

  const launch: LaunchSession = (_context, receive, exited) => {
    const received: Wire[] = [];
    let resolveExit: () => void;

    const completion = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    const child = {
      received,
      closing: false,
      delayExit: false,
      emit: (message: Wire) => receive(JSON.stringify({ jsonrpc: "2.0", ...message })),
      exit: () => {
        resolveExit();
        exited();
      },
    };

    children.push(child);

    return {
      send(line) {
        const message = wireSchema.parse(JSON.parse(line));
        child.received.push(message);
        // The transport is asynchronous, like the real child-process IPC.
        void Promise.resolve().then(() => {
          if (["thread/start", "thread/resume"].includes(message.method ?? ""))
            child.emit({
              method: "thread/identity",
              params: {
                threadId: message.params?.threadId,
                providerThreadId: message.params?.providerThreadId ?? "agent-a",
              },
            });

          if (
            ["initialize", "thread/start", "thread/resume", "turn/start"].includes(
              message.method ?? "",
            )
          )
            child.emit({ id: message.id, result: {} });
        });
      },
      close() {
        child.closing = true;

        if (!child.delayExit) void Promise.resolve().then(child.exit);

        return completion;
      },
    };
  };

  const bridge = createIsolatedBridge(
    "file:///unused.mjs",
    (line) => {
      messages.push(wireSchema.parse(JSON.parse(line)));
    },
    launch,
  );

  bridge.start?.({ pluginId: "cursor-sdk", dataDir: directory, tempDir: directory });
  let sequence = 0;
  const send = (message: Wire) => bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", ...message }));

  const request = async (
    method: string,
    params: NonNullable<Wire["params"]> = { threadId: "a" },
  ) => {
    const id = ++sequence;
    send({ id, method, params });
    await vi.advanceTimersByTimeAsync(0);

    return id;
  };

  const complete = (child = children[0]) =>
    child.emit({
      method: "thread/delta",
      params: { threadId: "a", deltas: [{ kind: "turn.boundary", status: "completed" }] },
    });

  cleanups.push(async () => {
    for (const child of children) {
      child.delayExit = false;

      if (child.closing) child.exit();
    }

    await bridge.onClose();
    rmSync(directory, { recursive: true, force: true });
  });

  return { children, messages, request, send, complete };
}

async function start(f: ReturnType<typeof fixture>, providerThreadId?: string) {
  await f.request("initialize", { protocolVersion: 2, client: { name: "test", version: "1" } });
  await f.request("thread/start", {
    threadId: "a",
    providerThreadId,
    input: [{ type: "text", text: "Original prompt must not be replayed" }],
    options: { envVars: { BB_THREAD_ID: "a" }, model: "saved-model" },
    dynamicTools: [{ name: "saved-tool" }],
  });
}

test("retires an idle local process after a minute and restores the same conversation for the next message", async () => {
  const f = fixture();
  await start(f);
  await f.request("turn/start");
  f.complete();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(f.children[0].closing).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.children[0].closing).toBe(true);
  expect(f.messages.filter((message) => message.method === "thread/delta")).toHaveLength(1);

  await f.request("turn/start", { threadId: "a", input: [{ type: "text", text: "Next prompt" }] });
  expect(f.children).toHaveLength(2);
  expect(f.children[1].received.map((message) => message.method)).toEqual([
    "initialize",
    "thread/resume",
    "turn/start",
  ]);
  expect(f.children[1].received[1].params).toEqual({
    threadId: "a",
    providerThreadId: "agent-a",
    options: { envVars: { BB_THREAD_ID: "a" }, model: "saved-model" },
    dynamicTools: [{ name: "saved-tool" }],
  });
  expect(f.children[1].received[2].params?.input).toEqual([{ type: "text", text: "Next prompt" }]);
});

test("a follow-up reuses the warm process and active turns can outlive the idle timeout", async () => {
  const f = fixture();
  await start(f);
  await vi.advanceTimersByTimeAsync(59_999);
  await f.request("turn/start");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.children).toHaveLength(1);
  expect(f.children[0].closing).toBe(false);
  f.complete();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(f.children[0].closing).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.children[0].closing).toBe(true);
});

test("pending tool callbacks and requests keep the session alive until both finish", async () => {
  const f = fixture();
  await start(f);
  await f.request("turn/start");
  f.children[0].emit({ id: "tool", method: "item/tool/call", params: { threadId: "a" } });
  f.complete();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.children[0].closing).toBe(false);
  const requestId = await f.request("inspect");
  const callback = f.messages.find((message) => message.method === "item/tool/call")!;
  f.send({ id: callback.id, result: { accepted: true } });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.children[0].closing).toBe(false);
  f.children[0].emit({ id: requestId, result: {} });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.children[0].closing).toBe(true);
});

test("a new message waits for the retiring process to exit before restoring its checkpoint", async () => {
  const f = fixture();
  await start(f);
  f.children[0].delayExit = true;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.children[0].closing).toBe(true);
  await f.request("turn/start");
  expect(f.children).toHaveLength(1);
  f.children[0].exit();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.children).toHaveLength(2);
  expect(f.children[1].received.map((message) => message.method)).toEqual([
    "initialize",
    "thread/resume",
    "turn/start",
  ]);
});

test("cloud sessions retain their existing lifetime after a completed turn", async () => {
  const f = fixture();
  await start(f, "bc-a");
  await f.request("turn/start");
  f.complete();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.children[0].closing).toBe(false);
});
