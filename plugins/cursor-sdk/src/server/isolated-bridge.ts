import { spawn } from "node:child_process";
import {
  experimental_defineProviderBridge,
  type ProviderBridgeContext,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { createSdkBridge } from "./bridge.js";

const messageSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string().optional(),
    params: z.object({ threadId: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

type Message = z.infer<typeof messageSchema>;

type RequestId = string | number;

export interface SessionProcess {
  send(line: string): void;
  close(): void;
}

export type LaunchSession = (
  context: ProviderBridgeContext,
  receive: (line: string) => void,
  exited: () => void,
) => SessionProcess;

// The SDK's local shell/MCP execution inherits process.env. Give each BB
// session a process for its entire lifetime, including asynchronous tool calls.
function launcher(moduleUrl: string): LaunchSession {
  return (context, receive, exited) => {
    const script = `
      const { createSdkBridge } = await import(${JSON.stringify(moduleUrl)});
      const bridge = createSdkBridge({}, line => process.send?.(line));
      bridge.start(${JSON.stringify(context)});
      process.on("message", line => bridge.handleLine(line));
      let closing = false;
      const close = () => {
        if (closing) return;
        closing = true;
        // Finish SDK cancellation/persistence before a graceful exit. If it
        // hangs, the next session can recover under its exclusive local lease.
        const deadline = setTimeout(() => process.exit(1), 5000);
        Promise.resolve(bridge.onClose?.()).then(
          () => { clearTimeout(deadline); process.exit(0); },
          () => { clearTimeout(deadline); process.exit(1); },
        );
      };
      process.once("disconnect", close);
      process.once("SIGTERM", close);
    `;

    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: { ...process.env },
    });

    child.on("message", (value) => {
      const line = z.string().safeParse(value);

      if (line.success) receive(line.data);
    });
    child.once("error", exited);
    child.once("exit", exited);

    return {
      send(line) {
        child.send(line, (error) => {
          if (error) exited();
        });
      },
      close() {
        child.kill("SIGTERM");
        const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
        timeout.unref();
        child.once("exit", () => clearTimeout(timeout));
      },
    };
  };
}

export function createIsolatedBridge(
  moduleUrl: string,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  launch: LaunchSession = launcher(moduleUrl),
) {
  const maintenance = createSdkBridge({}, write);
  let context: ProviderBridgeContext;
  let initialize: Message | undefined;
  let sequence = 0;
  let closing = false;

  type Session = {
    process: SessionProcess;
    pending: Map<RequestId, string>;
    ready: boolean;
    queue: string[];
    providerThreadId?: string;
    active: boolean;
  };

  const sessions = new Map<string, Session>();
  const callbacks = new Map<string, { session: Session; id: RequestId }>();
  const send = (message: Message) => write(JSON.stringify(message));

  const fail = (id: RequestId, message: string) =>
    send({ jsonrpc: "2.0", id, error: { code: -32603, message } });

  const release = (threadId: string, session: Session) => {
    if (sessions.get(threadId) !== session) return;
    sessions.delete(threadId);

    for (const [id, callback] of callbacks) {
      if (callback.session === session) callbacks.delete(id);
    }

    session.process.close();
  };

  const open = (threadId: string) => {
    const initId = `cursor-init-${++sequence}`;

    const session: Session = {
      process: launch(
        context,
        (line) => {
          const message = messageSchema.parse(JSON.parse(line));

          if (message.id === initId) {
            if (message.error) {
              for (const id of session.pending.keys())
                fail(id, "Cursor session initialization failed.");
              release(threadId, session);

              return;
            }

            session.ready = true;

            for (const queued of session.queue.splice(0)) session.process.send(queued);

            return;
          }

          if (message.method && message.id != null) {
            const id = `cursor-callback-${++sequence}`;
            callbacks.set(id, { session, id: message.id });
            send({ ...message, id });

            return;
          }

          if (message.method === "thread/identity") {
            session.providerThreadId = z.string().parse(message.params?.providerThreadId);
          }

          if (message.method === "thread/delta") {
            const deltas = z.array(z.object({ kind: z.string() })).parse(message.params?.deltas);

            if (deltas.some((delta) => delta.kind === "turn.boundary")) session.active = false;
          }

          send(message);

          if (message.id != null) {
            const method = session.pending.get(message.id);
            session.pending.delete(message.id);

            if (method === "turn/start" && message.error) session.active = false;

            if (
              (!message.error && (method === "thread/stop" || method === "thread/discard")) ||
              (message.error &&
                !session.providerThreadId &&
                ["thread/start", "thread/resume", "thread/fork"].includes(method ?? ""))
            ) {
              release(threadId, session);
            }
          }
        },
        () => {
          if (sessions.get(threadId) !== session) return;

          for (const id of session.pending.keys())
            fail(id, "Cursor session process exited unexpectedly. Resume the thread to retry.");

          if (session.active)
            send({
              jsonrpc: "2.0",
              method: "thread/delta",
              params: {
                threadId,
                deltas: [
                  {
                    kind: "turn.boundary",
                    status: "failed",
                    claimIfIdle: true,
                    error: { message: "Cursor session process exited unexpectedly." },
                  },
                ],
              },
            });
          release(threadId, session);
        },
      ),
      pending: new Map(),
      ready: false,
      queue: [],
      active: false,
    };

    sessions.set(threadId, session);
    session.process.send(JSON.stringify({ ...initialize, id: initId }));

    return session;
  };

  const shutdown = () => {
    closing = true;
    void maintenance.onClose?.();

    for (const [threadId, session] of sessions) release(threadId, session);
  };

  return experimental_defineProviderBridge({
    start(value) {
      context = value;
      maintenance.start?.(value);
    },
    handleLine(line) {
      if (closing) return;
      let message: Message;

      try {
        message = messageSchema.parse(JSON.parse(line));
      } catch {
        maintenance.handleLine(line);

        return;
      }

      if (!message.method && message.id != null) {
        const callback = callbacks.get(String(message.id));

        if (callback) {
          callbacks.delete(String(message.id));
          callback.session.process.send(JSON.stringify({ ...message, id: callback.id }));
        }

        return;
      }

      if (message.method === "initialize") initialize = message;
      const threadId = message.params?.threadId;

      if (!initialize || !threadId || message.id == null) {
        maintenance.handleLine(line);

        return;
      }

      if (
        message.method === "thread/fork" &&
        [...sessions.values()].some(
          (session) =>
            session.providerThreadId === message.params?.sourceProviderThreadId && session.active,
        )
      ) {
        fail(message.id, "Wait for the source thread to finish before forking.");

        return;
      }

      const session = sessions.get(threadId) ?? open(threadId);
      session.pending.set(message.id, message.method ?? "");

      if (message.method === "turn/start") session.active = true;

      if (session.ready) session.process.send(line);
      else session.queue.push(line);
    },
    onClose: shutdown,
    onSigterm: shutdown,
    onSigint: shutdown,
  });
}
