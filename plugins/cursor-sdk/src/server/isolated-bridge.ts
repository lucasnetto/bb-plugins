import { spawn } from "node:child_process";
import {
  experimental_defineProviderBridge,
  type ProviderBridgeContext,
  type ThreadDelta,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { createSdkBridge } from "./bridge.js";

const messageSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string().optional(),
    params: z
      .object({ threadId: z.string().optional(), providerThreadId: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

type Message = z.infer<typeof messageSchema>;

type RequestId = string | number;

export interface SessionProcess {
  send(line: string): void;
  /** Resolves only after the OS confirms the child has exited. */
  close(): Promise<void>;
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

    let stopped = false;
    let stopping = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const completion = new Promise<void>((resolve) => {
      child.once("close", () => {
        stopped = true;
        clearTimeout(killTimer);
        resolve();
        exited();
      });
    });

    const close = () => {
      if (!stopped && !stopping) {
        stopping = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
        killTimer.unref();
      }

      return completion;
    };

    child.on("message", (value) => {
      const line = z.string().safeParse(value);

      if (line.success) receive(line.data);
    });
    // A failed IPC write is not proof that the owner is dead. Wait for close
    // before allowing another child to acquire the conversation's lease.
    child.once("error", close);

    return {
      send(line) {
        child.send(line, (error) => {
          if (error) void close();
        });
      },
      close,
    };
  };
}

export function createIsolatedBridge(
  moduleUrl: string,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  launch: LaunchSession = launcher(moduleUrl),
  stopTimeoutMs = 10_000,
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
    construction?: Message;
    recycle?: boolean;
    stopTimer?: ReturnType<typeof setTimeout>;
    forcedStop?: boolean;
  };

  const sessions = new Map<string, Session>();
  const retiring = new Map<string, Promise<void>>();
  const restores = new Map<string, Message>();
  const callbacks = new Map<string, { session: Session; id: RequestId }>();
  const send = (message: Message) => write(JSON.stringify(message));

  const fail = (id: RequestId, message: string) =>
    send({ jsonrpc: "2.0", id, error: { code: -32603, message } });

  const release = (threadId: string, session: Session) => {
    if (sessions.get(threadId) !== session) return;
    sessions.delete(threadId);
    clearTimeout(session.stopTimer);

    for (const [id, callback] of callbacks) {
      if (callback.session === session) callbacks.delete(id);
    }

    const stopped = session.process.close();
    retiring.set(threadId, stopped);
    void stopped.then(() => {
      if (retiring.get(threadId) === stopped) retiring.delete(threadId);
    });
  };

  const open = (threadId: string, restore?: Message) => {
    const initId = `cursor-init-${++sequence}`;
    const resumeId = `cursor-resume-${++sequence}`;

    const session: Session = {
      process: launch(
        context,
        (line) => {
          if (sessions.get(threadId) !== session) return;
          const message = messageSchema.parse(JSON.parse(line));

          if (message.id === initId || message.id === resumeId) {
            if (message.error) {
              for (const id of session.pending.keys()) send({ ...message, id });
              release(threadId, session);

              return;
            }

            if (message.id === initId && restore) {
              session.process.send(JSON.stringify({ ...restore, id: resumeId }));

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
            const deltas = z
              .array(z.object({ kind: z.string(), status: z.string().optional() }))
              .parse(message.params?.deltas);

            if (deltas.some((delta) => delta.kind === "turn.boundary")) session.active = false;

            if (
              deltas.some((delta) => delta.kind === "turn.boundary" && delta.status === "failed") &&
              !session.providerThreadId?.startsWith("bc-")
            )
              session.recycle = true;
          }

          send(message);

          if (message.id != null) {
            const method = session.pending.get(message.id);
            session.pending.delete(message.id);

            if (
              !message.error &&
              session.construction?.id === message.id &&
              session.providerThreadId
            ) {
              const {
                input: _input,
                sourceProviderThreadId: _source,
                sourceProviderCheckpointId: _checkpoint,
                ...params
              } = session.construction.params ?? {};

              restores.set(threadId, {
                jsonrpc: "2.0",
                method: "thread/resume",
                params: { ...params, threadId, providerThreadId: session.providerThreadId },
              });
            }

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

          if (session.recycle && session.pending.size === 0) release(threadId, session);
        },
        () => {
          if (sessions.get(threadId) !== session) return;

          if (session.active) {
            const boundary: Extract<ThreadDelta, { kind: "turn.boundary" }> = {
              kind: "turn.boundary",
              status: session.forcedStop ? "interrupted" : "failed",
              claimIfIdle: true,
            };

            if (!session.forcedStop)
              boundary.error = {
                message:
                  "Cursor session process exited unexpectedly. The saved conversation can be resumed.",
              };
            send({
              jsonrpc: "2.0",
              method: "thread/delta",
              params: {
                threadId,
                deltas: [boundary],
              },
            });
          }

          for (const [id, method] of session.pending) {
            if (session.forcedStop && ["thread/stop", "thread/discard"].includes(method))
              send({ jsonrpc: "2.0", id, result: {} });
            else
              fail(
                id,
                "Cursor session process exited unexpectedly. Send a new message to resume the saved conversation.",
              );
          }

          release(threadId, session);
        },
      ),
      pending: new Map(),
      ready: false,
      queue: [],
      active: false,
      providerThreadId: restore?.params?.providerThreadId,
    };

    sessions.set(threadId, session);
    session.process.send(JSON.stringify({ ...initialize, id: initId }));

    return session;
  };

  const shutdown = () => {
    closing = true;
    const maintenanceClosed = maintenance.onClose?.();

    for (const [threadId, session] of sessions) release(threadId, session);
    restores.clear();

    return Promise.all([maintenanceClosed, ...retiring.values()]).then(() => {});
  };

  const bridge = experimental_defineProviderBridge({
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

      const dispatch = async () => {
        const previous = retiring.get(threadId);

        if (previous) await previous;

        if (closing || message.id == null) return;

        if (message.method === "thread/discard") restores.delete(threadId);

        if (
          !sessions.has(threadId) &&
          ["thread/stop", "thread/discard"].includes(message.method ?? "")
        ) {
          if (
            message.method === "thread/stop" &&
            message.params?.intent !== "release" &&
            message.params?.providerThreadId?.startsWith("bc-")
          ) {
            fail(
              message.id,
              "Cursor Cloud cancellation cannot be confirmed after the session process exited. Stop the remote agent in Cursor before resuming.",
            );

            return;
          }

          send({ jsonrpc: "2.0", id: message.id, result: {} });

          return;
        }

        const session =
          sessions.get(threadId) ??
          open(threadId, message.method === "turn/start" ? restores.get(threadId) : undefined);

        session.pending.set(message.id, message.method ?? "");

        if (["thread/start", "thread/resume", "thread/fork"].includes(message.method ?? ""))
          session.construction = message;

        if (message.method === "turn/start") session.active = true;

        if (
          ["thread/stop", "thread/discard"].includes(message.method ?? "") &&
          (session.providerThreadId ?? message.params?.providerThreadId)?.startsWith("agent-") &&
          !session.stopTimer
        ) {
          session.stopTimer = setTimeout(() => {
            session.forcedStop = true;
            void session.process.close();
          }, stopTimeoutMs);
        }

        if (session.ready) session.process.send(line);
        else session.queue.push(line);
      };

      void dispatch().catch(() => {
        if (message.id != null) fail(message.id, "Could not restore the Cursor session process.");
      });
    },
    onClose: shutdown,
    onSigterm: shutdown,
    onSigint: shutdown,
  });

  return { ...bridge, onClose: shutdown };
}
