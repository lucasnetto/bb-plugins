import type {
  AgentOptions,
  SendOptions,
  SDKAgent,
  SDKCustomTool,
  SDKImage,
  SDKModel,
  Run,
  LocalAgentStore,
} from "@cursor/sdk";
import {
  experimental_defineProviderBridge,
  createBridgeIo,
  createPendingToolCallTracker,
  decodeBridgeJsonRpcResponse,
  bridgeRequestEnvelopeSchema,
  initializeParamsSchema,
  modelListParamsSchema,
  providerMaintenanceParamsSchema,
  providerInstallationStatusParamsSchema,
  providerInstallationRunParamsSchema,
  threadStartParamsSchema,
  threadResumeParamsSchema,
  threadForkParamsSchema,
  threadStopParamsSchema,
  threadDiscardParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
  experimental_BridgeRecoveryError,
  BRIDGE_JSON_RPC_ERRORS,
  mimeTypeFromExtension,
  type ThreadDelta,
  type DynamicTool,
  type ProviderHealth,
} from "@get-bb/plugin-sdk/provider-bridge";
import { acquireLocalLease } from "./local-state.js";
import { conversationStores } from "./conversation-store.js";
import type { PhaseEvent, StartupPhase } from "../shared/diagnostics.js";
import { Cause, Deferred, Effect, Fiber, Stream } from "effect";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  foreign,
  readApiKey,
  safeMessage,
  sdkError,
  sdkErrorInfo,
  sdkRecovery,
  optionsSchema,
  SdkError,
  type Profile,
} from "./operations.js";
import {
  loadSdk,
  installCommand,
  installationStatus,
  SDK_VERSION,
  type SdkModule,
} from "./runtime.js";
import { resolveModel } from "./models.js";
import { createModelCache } from "./model-cache.js";
import { RunEvents, runStatus } from "./events.js";
import {
  cloudRunSummary,
  openCloudSession,
  readCloudSource,
  type CloudSession,
  type CloudSource,
} from "./cloud.js";
import { forkLocalAgent } from "./fork.js";
import { randomUUID } from "node:crypto";

const requestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("initialize"), params: initializeParamsSchema }),
  z.object({ method: z.literal("thread/start"), params: threadStartParamsSchema }),
  z.object({ method: z.literal("thread/resume"), params: threadResumeParamsSchema }),
  z.object({ method: z.literal("thread/fork"), params: threadForkParamsSchema }),
  z.object({ method: z.literal("thread/stop"), params: threadStopParamsSchema }),
  z.object({ method: z.literal("thread/discard"), params: threadDiscardParamsSchema }),
  z.object({ method: z.literal("turn/start"), params: turnStartParamsSchema }),
  z.object({ method: z.literal("turn/steer"), params: turnSteerParamsSchema }),
  z.object({ method: z.literal("model/list"), params: modelListParamsSchema }),
  z.object({ method: z.literal("provider/health"), params: providerMaintenanceParamsSchema }),
  z.object({ method: z.literal("provider/usage"), params: providerMaintenanceParamsSchema }),
  z.object({
    method: z.literal("provider/installation/status"),
    params: providerInstallationStatusParamsSchema,
  }),
  z.object({
    method: z.literal("provider/installation/run"),
    params: providerInstallationRunParamsSchema,
  }),
]);

type BridgeRequest = z.infer<typeof requestSchema>;

type StartParams = z.infer<typeof threadStartParamsSchema>;

type ResumeParams = z.infer<typeof threadResumeParamsSchema>;

type ForkParams = z.infer<typeof threadForkParamsSchema>;

type TurnParams = z.infer<typeof turnStartParamsSchema>;

type Options = StartParams["options"];

type TurnState = {
  clientRequestId: string;
  accepted: boolean;
  run?: Run;
  pendingRun?: Promise<Run>;
  cancellation?: Promise<void>;
  providerTurnId?: string;
  providerCheckpointId?: string;
  pending: TurnParams[];
  options: TurnParams["options"];
  steers: Set<Deferred.Deferred<void>>;
  steerFibers: Set<Fiber.Fiber<void, never>>;
  events: RunEvents;
  toolEpoch: object;
  interrupted: boolean;
  ended: boolean;
  fiber?: Fiber.Fiber<void, never>;
};

type Session = {
  cloud?: CloudSession;
  localStore?: LocalAgentStore;
  releaseLease?: () => void;
  recoverLocalRun?: boolean;
  closing?: Promise<void>;
  models: SDKModel[];
  threadId: string;
  agent: SDKAgent;
  instructions?: string;
  lastInstructions?: string;
  toolDefinitions: DynamicTool[];
  env: Record<string, string>;
  turn?: TurnState;
  released: boolean;
};

export interface BridgeDependencies {
  load: (dataDir: string) => Effect.Effect<SdkModule, SdkError>;
  key: (profile: Profile) => Effect.Effect<string, SdkError>;
  source: (cwd: string) => Effect.Effect<CloudSource, SdkError>;
  cleanupTimeoutMs: number;
  phase: (threadId: string, event: PhaseEvent) => void;
}

export function createSdkBridge(
  dependencies: Partial<BridgeDependencies> = {},
  write?: (line: string) => void,
) {
  const load = dependencies.load ?? loadSdk;
  const key = dependencies.key ?? readApiKey;
  const cleanupTimeoutMs = dependencies.cleanupTimeoutMs ?? 5000;
  const modelCache = createModelCache(load);
  const io = createBridgeIo<unknown>({ write });
  const tools = createPendingToolCallTracker({ sendToolCall: io.send });
  const sessions = new Map<string, Session>();
  const constructing = new Set<string>();
  const requests = new Set<AbortController>();
  let dataDir = "";
  let initialized = false;
  let closing = false;
  const baseEnv = { ...process.env };

  const phase = <A>(threadId: string, name: StartupPhase, effect: Effect.Effect<A, SdkError>) =>
    Effect.gen(function* () {
      const started = Date.now();
      dependencies.phase?.(threadId, { phase: name, state: "started" });

      return yield* effect.pipe(
        Effect.tap(() =>
          Effect.sync(() =>
            dependencies.phase?.(threadId, {
              phase: name,
              state: "succeeded",
              durationMs: Date.now() - started,
            }),
          ),
        ),
        Effect.onError(() =>
          Effect.sync(() =>
            dependencies.phase?.(threadId, {
              phase: name,
              state: "failed",
              durationMs: Date.now() - started,
            }),
          ),
        ),
      );
    });

  const emit = (threadId: string, deltas: ThreadDelta[]) => {
    if (!closing && deltas.length)
      io.send({ jsonrpc: "2.0", method: "thread/delta", params: { threadId, deltas } });
  };

  const checkOptions = (options: Options) => {
    if (options.permissionMode !== "full")
      throw new SdkError({ message: "Cursor SDK currently supports Full access mode only." });
  };

  const getSession = (threadId: string, providerThreadId: string) => {
    const session = sessions.get(threadId);

    if (!session || session.agent.agentId !== providerThreadId || session.released)
      throw new SdkError({ message: "Cursor SDK session is not loaded. Resume the thread first." });

    return session;
  };

  const customTools = (
    definitions: DynamicTool[],
    session: Session,
    turn: TurnState,
  ): Record<string, SDKCustomTool> => {
    const epoch = turn.toolEpoch;

    return Object.fromEntries(
      definitions.map((definition) => [
        definition.name,
        {
          description: definition.description,
          inputSchema: z.record(z.string(), z.json()).parse(definition.inputSchema),
          execute: (args) => {
            if (
              session.released ||
              session.turn !== turn ||
              turn.toolEpoch !== epoch ||
              turn.interrupted ||
              turn.ended
            )
              return Promise.resolve({
                content: [{ type: "text" as const, text: "The Cursor turn has ended." }],
                isError: true,
              });

            return Effect.runPromise(
              foreign(() =>
                tools.forwardToolCall({
                  arguments: args,
                  providerThreadId: session.agent.agentId,
                  threadId: session.threadId,
                  toolName: definition.name,
                  scope: turn,
                }),
              ).pipe(
                Effect.map((result) => ({
                  content: [
                    { type: "text" as const, text: result.content },
                    ...(result.images ?? []).map((image) => ({
                      type: "image" as const,
                      data: image.data,
                      mimeType: image.mimeType,
                    })),
                  ],
                  isError: result.isError,
                })),
              ),
            );
          },
        } satisfies SDKCustomTool,
      ]),
    );
  };

  const pendingRun = Effect.fn("CursorSdk.pendingRun")(function* (turn: TurnState) {
    const pending = turn.pendingRun;

    if (!pending) return turn.run;

    // A rejected send produced no handle; executeTurn reports that failure.
    return yield* foreign(() => pending).pipe(Effect.catch(() => Effect.succeed(undefined)));
  });

  const cancelRun = Effect.fn("CursorSdk.cancelRun")(function* (session: Session, turn: TurnState) {
    if (!turn.cancellation) {
      const cancellation = Effect.runPromise(
        Effect.gen(function* () {
          const run = yield* pendingRun(turn);

          if (!run) return;
          yield* foreign(() => run.cancel());

          const store = session.localStore;

          if (store) {
            const saved = yield* foreign(() =>
              store.runs.get({ agentId: session.agent.agentId, runId: run.id }),
            );

            if (saved?.status === "running" || saved?.status === "queued")
              return yield* Effect.fail(
                new SdkError({
                  message:
                    "Cursor cancellation has not been saved. The session remains open; retry Stop.",
                }),
              );
          }
        }),
      );

      turn.cancellation = cancellation;
      void cancellation.catch(() => {
        if (turn.cancellation === cancellation) turn.cancellation = undefined;
      });
    }

    const cancellation = turn.cancellation;
    yield* foreign(() => cancellation);
  });

  const closeSession = Effect.fn("CursorSdk.closeSession")(function* (session: Session) {
    if (!session.closing) {
      const closing = Effect.runPromise(
        phase(session.threadId, "cleanup", closeSessionOnce(session)),
      );

      session.closing = closing;
      void closing.catch(() => {
        if (session.closing === closing) session.closing = undefined;
      });
    }

    const closing = session.closing;
    yield* foreign(() => closing);
  });

  const closeSessionOnce = Effect.fn("CursorSdk.closeSessionOnce")(function* (session: Session) {
    const turn = session.turn;

    // Custom tools have no SDK abort signal. Unblock their host callbacks before
    // waiting for cancellation, which can itself be waiting for tool completion.
    if (turn) tools.resolvePendingToolCalls(turn, "The Cursor SDK session was released.");

    if (turn && !turn.ended) {
      turn.interrupted = true;

      // A successful stop reply lets the isolated bridge kill this process.
      // Resolve run creation and cancellation before allowing that reply.
      if (session.cloud && !turn.cancellation) yield* pendingRun(turn);
      else yield* cancelRun(session, turn);
    }

    session.released = true;

    if (turn) yield* Effect.forEach([...turn.steerFibers], Fiber.interrupt);
    yield* Effect.void.pipe(
      Effect.ensuring(
        foreign(() => session.agent[Symbol.asyncDispose]()).pipe(Effect.catch(() => Effect.void)),
      ),
      Effect.ensuring(
        Effect.gen(function* () {
          if (session.turn?.fiber) yield* Fiber.interrupt(session.turn.fiber);
          session.releaseLease?.();
          sessions.delete(session.threadId);

          if (sessions.size === 0) {
            for (const name of Object.keys(process.env))
              if (!(name in baseEnv)) delete process.env[name];
            Object.assign(process.env, baseEnv);
          }
        }),
      ),
    );
  });

  const openSession = Effect.fn("CursorSdk.openSession")(function* (
    params: StartParams | ResumeParams | ForkParams,
  ) {
    checkOptions(params.options);

    if (constructing.has(params.threadId) || sessions.has(params.threadId)) {
      return yield* Effect.fail(
        new SdkError({ message: "Release this SDK session before opening it again." }),
      );
    }

    if ("sourceProviderThreadId" in params) {
      if (String(params.sourceProviderThreadId).startsWith("bc-"))
        return yield* Effect.fail(
          new SdkError({
            message:
              "Cursor Cloud conversations cannot be forked. Forking is available for local Cursor SDK threads.",
          }),
        );

      const source = [...sessions.values()].find(
        (session) => session.agent.agentId === params.sourceProviderThreadId,
      );

      if (source?.turn && !source.turn.ended)
        return yield* Effect.fail(
          new SdkError({ message: "Wait for the source thread to finish before forking." }),
        );
    }

    constructing.add(params.threadId);
    let releaseLease: (() => void) | undefined;
    let releaseSource: (() => void) | undefined;
    let opening: Promise<SDKAgent> | undefined;

    const nativeOpen = (operation: () => Promise<SDKAgent>) => {
      opening = operation();

      return opening;
    };

    return yield* Effect.gen(function* () {
      const { profile, runtime } = optionsSchema.parse(params.options.providerOptions);

      // A saved native identity owns its runtime. The setting only selects
      // where a new conversation starts, including after a bridge restart.
      const isCloud =
        "providerThreadId" in params
          ? String(params.providerThreadId).startsWith("bc-")
          : "sourceProviderThreadId" in params
            ? false
            : runtime === "cloud";

      if (isCloud && (params.disallowedTools?.length || params.instructionMode === "replace"))
        return yield* Effect.fail(
          new SdkError({
            message:
              "Cursor Cloud cannot enforce tool denylists or replace its system prompt. Use the local Cursor SDK provider for this policy.",
          }),
        );

      const step = <A>(name: StartupPhase, effect: Effect.Effect<A, SdkError>) =>
        phase(params.threadId, name, effect);

      const sdk = yield* step("sdk-load", load(dataDir));
      const apiKey = yield* step("credentials", key(profile));
      let models = yield* step("model-catalog", modelCache.native(dataDir, profile, apiKey));

      const selectModel = () =>
        params.options.model
          ? resolveModel(
              params.options.model,
              models,
              params.options.reasoningLevel,
              params.options.serviceTier,
            )
          : undefined;

      const model = yield* Effect.try({ try: selectModel, catch: sdkError }).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            // A cached catalog can predate a newly selected model/variant.
            models = yield* step(
              "model-catalog",
              modelCache.native(dataDir, profile, apiKey, true),
            );

            return yield* Effect.try({ try: selectModel, catch: sdkError });
          }),
        ),
      );

      if (!model)
        return yield* Effect.fail(
          new SdkError({ message: "Select a Cursor SDK model before starting a thread." }),
        );
      const env = isCloud ? {} : { ...params.options.envVars, CURSOR_API_KEY: apiKey };

      if (
        [...sessions.values()].some(
          (session) =>
            !isCloud && !session.cloud && JSON.stringify(session.env) !== JSON.stringify(env),
        )
      ) {
        return yield* Effect.fail(
          new SdkError({
            message:
              "SDK sessions with different environments require separate provider bridge processes.",
          }),
        );
      }

      if (!isCloud) Object.assign(process.env, env);
      const storeDirectory = join(dataDir, "conversations", profile);

      const stores = conversationStores(
        storeDirectory,
        (path) => new sdk.JsonlLocalAgentStore(path),
      );

      if ("sourceProviderThreadId" in params)
        releaseSource = acquireLocalLease(
          storeDirectory,
          `migration:${String(params.sourceProviderThreadId)}`,
        );

      const allocated = !isCloud && !("providerThreadId" in params) ? stores.allocate() : undefined;
      let store = allocated?.store;

      const claim = (agentId: string) => {
        releaseLease = acquireLocalLease(storeDirectory, `agent:${agentId}`);
      };

      let recoverLocalRun = false;

      if (!isCloud && "providerThreadId" in params) {
        const agentId = String(params.providerThreadId);
        claim(agentId);
        store = yield* step(
          "checkpoint-load",
          foreign(() => stores.open(agentId)),
        );
        const localStore = store;
        const saved = yield* foreign(() => localStore.agents.get({ agentId }));

        // Cursor scopes even explicit stores by cwd. Follow BB's current workspace
        // under the agent lease, keeping the identity, checkpoint and run history.
        if (saved && saved.cwd !== params.cwd)
          yield* foreign(() =>
            localStore.agents.update({
              agent: { ...saved, cwd: params.cwd, updatedAt: Date.now() },
            }),
          );

        if (saved?.activeRunId) {
          const runId = saved.activeRunId;
          const run = yield* foreign(() => localStore.runs.get({ agentId, runId }));
          recoverLocalRun = run?.status === "running" || run?.status === "queued";
        }
      }

      const options: AgentOptions = {
        apiKey,
        model,
        local: { cwd: params.cwd, store, settingSources: ["project", "user", "plugins"] },
        mode: params.options.promptMode === "plan" ? ("plan" as const) : ("agent" as const),
      };

      if (params.disallowedTools?.length) options.disallowedTools = params.disallowedTools;

      if (params.instructionMode === "replace" && params.options.instructions)
        options.systemPrompt = params.options.instructions;

      const cloud = isCloud
        ? yield* step(
            "providerThreadId" in params ? "agent-resume" : "agent-create",
            openCloudSession({
              sdk,
              dataDir,
              profile,
              threadId: params.threadId,
              options: { apiKey, model, mode: options.mode },
              source: () => (dependencies.source ?? readCloudSource)(params.cwd),
              providerThreadId:
                "providerThreadId" in params ? String(params.providerThreadId) : undefined,
            }),
          )
        : undefined;

      const agent = cloud
        ? cloud.agent
        : "sourceProviderThreadId" in params
          ? yield* step(
              "agent-fork",
              forkLocalAgent(
                yield* step(
                  "checkpoint-load",
                  foreign(() => stores.open(String(params.sourceProviderThreadId), false)),
                ),
                String(params.sourceProviderThreadId),
                params.cwd,
                (id) => {
                  claim(id);

                  return nativeOpen(() => sdk.Agent.resume(id, options));
                },
                store,
                "sourceProviderCheckpointId" in params
                  ? z.string().optional().parse(params.sourceProviderCheckpointId)
                  : undefined,
              ),
            )
          : "providerThreadId" in params
            ? yield* step(
                "agent-resume",
                foreign(() =>
                  nativeOpen(() => sdk.Agent.resume(String(params.providerThreadId), options)),
                ),
              )
            : yield* step(
                "agent-create",
                foreign(() => nativeOpen(() => sdk.Agent.create(options))),
              );

      if (!isCloud && !releaseLease) claim(agent.agentId);

      if (allocated) yield* foreign(() => allocated.publish(agent.agentId));

      const session: Session = {
        cloud,
        localStore: isCloud ? undefined : store,
        releaseLease,
        recoverLocalRun,
        models,
        threadId: params.threadId,
        agent,
        instructions:
          params.instructionMode === "replace" ? undefined : params.options.instructions,
        toolDefinitions: isCloud ? [] : (params.dynamicTools ?? []),
        env,
        released: false,
      };

      sessions.set(params.threadId, session);
      io.send({
        jsonrpc: "2.0",
        method: "thread/identity",
        params: { threadId: params.threadId, providerThreadId: agent.agentId },
      });
      emit(params.threadId, [{ kind: "session.reset" }]);

      return { providerThreadId: agent.agentId };
    }).pipe(
      Effect.onError(() =>
        phase(
          params.threadId,
          "cleanup",
          foreign(async () => {
            // Interrupted SDK construction can finish late. Dispose it before giving
            // up ownership; the parent kills this process if construction never settles.
            const opened = await opening?.catch(() => undefined);

            if (opened) await opened[Symbol.asyncDispose]();
            releaseLease?.();
          }),
        ).pipe(Effect.orDie),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          constructing.delete(params.threadId);
          releaseSource?.();
        }),
      ),
    );
  });

  const prompt = Effect.fn("CursorSdk.prompt")(function* (params: TurnParams, session: Session) {
    const text: string[] = [];
    const images: SDKImage[] = [];
    const instructions = params.options.instructions ?? session.instructions;

    if (instructions && instructions !== session.lastInstructions) text.push(instructions);

    for (const input of params.input) {
      if (input.type === "text") text.push(input.text);
      else if (input.type === "localImage") {
        const bytes = yield* foreign(() => readFile(input.path));

        if (bytes.length > 15 * 1024 * 1024)
          return yield* Effect.fail(
            new SdkError({ message: "Image exceeds the Cursor SDK 15 MB limit." }),
          );
        images.push({
          data: bytes.toString("base64"),
          mimeType: mimeTypeFromExtension(input.path),
        });
      } else if (input.type === "image") images.push({ url: input.url });
      else if (input.type === "localFile") {
        if (session.cloud)
          return yield* Effect.fail(
            new SdkError({
              message:
                "Cursor Cloud cannot read local file attachments. Paste the relevant text, attach an image, or commit the file to the repository.",
            }),
          );
        text.push(`Attached file: ${input.path}`);
      }
    }

    if (images.length > 5)
      return yield* Effect.fail(
        new SdkError({ message: "Cursor SDK supports up to five images per message." }),
      );

    if (session.cloud)
      text.push(
        "<bb_cloud_runtime>Execution is on Cursor Cloud in the remote repository. Local BB host paths, environment variables, callback tools, and BB CLI access are unavailable. Use the cloud environment and its configured tools. Report remote branch or pull request links for any changes.</bb_cloud_runtime>",
      );

    const message: Exclude<Parameters<SDKAgent["send"]>[0], string> = { text: text.join("\n\n") };

    if (images.length) message.images = images;

    return { message, instructions };
  });

  const acceptInput = (session: Session, turn: TurnState) => {
    if (turn.accepted || session.released) return;
    turn.accepted = true;
    emit(session.threadId, [
      {
        kind: "input.accepted",
        clientRequestId: turn.clientRequestId,
        providerTurnId: turn.providerTurnId,
      },
    ]);
  };

  const finish = (
    session: Session,
    turn: TurnState,
    status: "completed" | "failed" | "interrupted",
    error?: SdkError,
  ) => {
    if (turn.ended) return;
    acceptInput(session, turn);
    turn.events.close(status);
    turn.ended = true;

    const boundary: Extract<ThreadDelta, { kind: "turn.boundary" }> = {
      kind: "turn.boundary",
      status,
      providerTurnId: turn.providerTurnId,
      claimIfIdle: true,
      providerCheckpointId: turn.providerCheckpointId,
    };

    if (error) {
      boundary.error = { message: error.message };

      if (!session.released) {
        const info = sdkErrorInfo(error);
        emit(session.threadId, [
          {
            kind: "provider.error",
            message: error.message,
            errorInfo: info,
            category: info.category,
            providerTurnId: turn.providerTurnId,
            settlesTurn: false,
            willRetry: false,
            detail: error.requestId
              ? `${error.message} (request ${error.requestId})`
              : error.message,
          },
        ]);
        const recovery = sdkRecovery(error);

        if (recovery)
          io.send({
            jsonrpc: "2.0",
            method: "provider/recovery",
            params: { ...recovery, threadId: session.threadId },
          });
      }
    }

    if (!session.released) emit(session.threadId, [boundary]);
  };

  const executeTurn: (
    params: TurnParams,
    session: Session,
    turn: TurnState,
  ) => Effect.Effect<void, SdkError> = Effect.fn("CursorSdk.executeTurn")(function* (
    params: TurnParams,
    session: Session,
    turn: TurnState,
  ) {
    if (session.released || turn.interrupted) return;
    turn.options = params.options;
    turn.providerCheckpointId = undefined;
    turn.toolEpoch = {};
    turn.run = undefined;
    turn.pendingRun = undefined;
    turn.cancellation = undefined;
    turn.events.startRun();
    const input = yield* prompt(params, session);

    const sendOptions: SendOptions = {
      mode: params.options.promptMode === "plan" ? "plan" : "agent",
      idempotencyKey: params.clientRequestId,
    };

    if (params.options.model)
      sendOptions.model = resolveModel(
        params.options.model,
        session.models,
        params.options.reasoningLevel,
        params.options.serviceTier,
      );

    if (!session.cloud) {
      sendOptions.local = { customTools: customTools(session.toolDefinitions, session, turn) };

      if (session.recoverLocalRun) sendOptions.local.force = true;
    }

    if (session.released || turn.interrupted) return;

    if (!turn.providerTurnId) {
      // A BB turn begins when we start the SDK request, not when the first
      // model response arrives. Cursor may take minutes to return its handle.
      turn.providerTurnId = turn.clientRequestId;
      emit(session.threadId, [{ kind: "turn.open", providerTurnId: turn.providerTurnId }]);
    }

    const creating = session.agent.send(input.message, sendOptions);
    session.recoverLocalRun = false;
    turn.pendingRun = creating;

    const run = yield* phase(
      session.threadId,
      "run-start",
      foreign(() => creating),
    );

    turn.run = run;

    if (session.cloud) yield* session.cloud.markCreated();

    // Stop owns cancellation and the terminal boundary once interruption begins.
    if (turn.interrupted || session.released) return;

    acceptInput(session, turn);
    session.lastInstructions = input.instructions;

    const cloudNote = (text: string) => {
      if (!text) return;
      const key = { providerItemId: `cloud-${randomUUID()}` };
      emit(session.threadId, [
        {
          kind: "item.textDelta",
          key,
          channel: "agentMessage",
          text,
          providerTurnId: turn.providerTurnId,
        },
        {
          kind: "item.textClose",
          key,
          channel: "agentMessage",
          providerTurnId: turn.providerTurnId,
        },
      ]);
    };

    if (session.cloud) cloudNote(cloudRunSummary(session.agent.agentId, session.cloud.source));
    yield* Stream.fromAsyncIterable(run.stream(), sdkError).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (!turn.ended && !session.released) turn.events.accept(event);
        }),
      ),
    );
    const result = yield* foreign(() => run.wait());

    if (turn.interrupted || session.released) return;

    if (!turn.ended) {
      turn.events.finish(result);

      if (session.cloud && result.git?.branches.length)
        cloudNote(cloudRunSummary(session.agent.agentId, session.cloud.source, result));
    }

    if (result.status !== "finished") {
      turn.pending.length = 0;
      yield* Effect.forEach([...turn.steerFibers], Fiber.interrupt);
      finish(
        session,
        turn,
        runStatus(result.status),
        result.error ? sdkError(result.error) : undefined,
      );

      return;
    }

    // A run can finish before Cursor acknowledges an in-flight steer. Keep
    // its BB turn open until delivery ownership has been resolved.
    yield* Effect.gen(function* () {
      while (turn.steers.size)
        yield* Effect.forEach([...turn.steers], (pending) => Deferred.await(pending));
    }).pipe(
      Effect.timeout(cleanupTimeoutMs),
      Effect.catch(() =>
        Effect.gen(function* () {
          yield* Effect.forEach([...turn.steerFibers], Fiber.interrupt);
          emit(session.threadId, [
            {
              kind: "provider.error",
              settlesTurn: false,
              willRetry: false,
              providerTurnId: turn.providerTurnId,
              message:
                "Cursor finished without confirming steering delivery. The uncertain message was not resent.",
            },
          ]);
        }),
      ),
    );

    const next = turn.pending.shift();

    if (next && !turn.interrupted && !session.released) {
      turn.clientRequestId = next.clientRequestId;
      turn.accepted = false;

      return yield* executeTurn(next, session, turn);
    }

    if (
      session.localStore &&
      result.status === "finished" &&
      !turn.interrupted &&
      !session.released
    ) {
      const savedRun = yield* foreign(() =>
        session.localStore!.runs.get({
          agentId: session.agent.agentId,
          runId: run.id,
        }),
      );

      if (savedRun?.status === "finished" && savedRun.latestCheckpointRef)
        turn.providerCheckpointId = savedRun.latestCheckpointRef.rootBlobId;
    }

    finish(
      session,
      turn,
      runStatus(result.status),
      result.error ? sdkError(result.error) : undefined,
    );
  });

  const startTurn = (params: TurnParams) =>
    Effect.sync(() => {
      checkOptions(params.options);
      const session = getSession(params.threadId, params.providerThreadId);

      if (session.turn && !session.turn.ended)
        throw new SdkError({
          message: "The SDK is already running a turn. Queue the follow-up in BB.",
        });

      const turn: TurnState = {
        clientRequestId: params.clientRequestId,
        accepted: false,
        pending: [],
        options: params.options,
        steers: new Set(),
        steerFibers: new Set(),
        toolEpoch: {},
        events: new RunEvents((deltas) => {
          if (!session.released)
            emit(
              session.threadId,
              deltas.map((delta) => ({ ...delta, providerTurnId: turn.providerTurnId })),
            );
        }),
        interrupted: false,
        ended: false,
      };

      const previous = session.turn?.fiber;
      session.turn = turn;
      turn.fiber = Effect.runFork(
        (previous ? Fiber.join(previous) : Effect.void).pipe(
          Effect.andThen(executeTurn(params, session, turn)),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (turn.interrupted || session.released) return;

              tools.resolvePendingToolCalls(turn, "The Cursor SDK turn failed.");
              yield* Effect.forEach([...turn.steerFibers], Fiber.interrupt);

              if (turn.run)
                yield* phase(session.threadId, "cleanup", cancelRun(session, turn)).pipe(
                  Effect.timeout(cleanupTimeoutMs),
                  Effect.catch(() => Effect.void),
                );
              finish(
                session,
                turn,
                turn.interrupted ? "interrupted" : "failed",
                sdkError(Cause.squash(cause)),
              );
            }),
          ),
        ),
      );

      return { accepted: true };
    });

  const steerTurn = Effect.fn("CursorSdk.steerTurn")(function* (
    params: z.infer<typeof turnSteerParamsSchema>,
  ) {
    checkOptions(params.options);
    const session = getSession(params.threadId, params.providerThreadId);
    const turn = session.turn;

    if (!turn || turn.ended || turn.interrupted || turn.providerTurnId !== params.expectedTurnId)
      return yield* Effect.fail(
        new experimental_BridgeRecoveryError({
          code: BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN,
          message: "The targeted Cursor SDK turn is no longer active.",
          recovery: {
            kind: "staleTurn",
            message: "The targeted Cursor SDK turn is no longer active.",
            retryable: false,
          },
        }),
      );

    const pending = Deferred.makeUnsafe<void>();
    turn.steers.add(pending);

    const delivery = Effect.gen(function* () {
      // Cursor's live input API is text-only. Preserve attachments and any
      // execution-option changes by sending them at the next prompt boundary.
      const textOnly = params.input.every((input) => input.type === "text");

      const unchangedInstructions =
        !params.options.instructions || params.options.instructions === session.lastInstructions;

      const sameExecution = ["model", "reasoningLevel", "serviceTier", "promptMode"] as const;

      const unchangedExecution = sameExecution.every(
        (key) => params.options[key] === turn.options[key],
      );

      const run = turn.run;
      const steer = run?.steer?.bind(run);

      const outcome =
        !session.cloud && textOnly && unchangedInstructions && unchangedExecution && steer
          ? yield* foreign(() =>
              steer(
                params.input
                  .flatMap((input) => (input.type === "text" ? [input.text] : []))
                  .join("\n\n"),
              ),
            )
          : "revert_to_followup";

      if (session.released || turn.interrupted || turn.ended) return;

      if (outcome === "complete_delivered") {
        emit(session.threadId, [
          {
            kind: "input.accepted",
            clientRequestId: params.clientRequestId,
            providerTurnId: turn.providerTurnId,
          },
        ]);
      } else {
        turn.pending.push(params);
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (session.released || turn.interrupted || turn.ended) return;
          // Delivery is uncertain. Report it without replaying the message or
          // making BB mark the still-running turn as a failed submit.
          emit(session.threadId, [
            {
              kind: "provider.error",
              message: `Cursor could not confirm steering delivery: ${error.message}`,
              providerTurnId: turn.providerTurnId,
              settlesTurn: false,
              willRetry: false,
              detail: `Steering request ${params.clientRequestId} was not resent.`,
            },
          ]);
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => turn.steers.delete(pending)).pipe(
          Effect.andThen(Deferred.succeed(pending, undefined)),
        ),
      ),
    );

    // Run.steer waits for consumption, potentially until a long-running tool
    // finishes. Acknowledge receipt now; input.accepted records actual delivery.
    const fiber = Effect.runFork(delivery);
    turn.steerFibers.add(fiber);
    fiber.addObserver(() => turn.steerFibers.delete(fiber));

    return { accepted: true };
  });

  const handle = Effect.fn("CursorSdk.handleRequest")(function* (request: BridgeRequest) {
    if (request.method === "initialize") {
      const params = request.params;

      if (params.protocolVersion !== 2)
        return yield* Effect.fail(
          new SdkError({ message: "Cursor SDK requires provider bridge protocol 2." }),
        );
      initialized = true;

      return {
        protocolVersion: 2,
        capabilities: {
          grammarVersions: [3, 3],
          sessionRestore: true,
          fork: "checkpoint",
          steerMode: "inject",
          approvalEnforcedBy: "provider",
          skills: { configure: false },
          threadArchive: false,
          threadRename: false,
          threadGoalClear: false,
        },
      };
    }

    if (!initialized)
      return yield* Effect.fail(new SdkError({ message: "Initialize the provider bridge first." }));

    switch (request.method) {
      case "thread/start":
        return yield* openSession(request.params);
      case "thread/fork":
      case "thread/resume":
        return yield* openSession(request.params);
      case "turn/start":
        return yield* startTurn(request.params);
      case "turn/steer":
        return yield* steerTurn(request.params);
      case "thread/stop": {
        const params = request.params;
        const session = sessions.get(params.threadId);

        if (!session || session.agent.agentId !== params.providerThreadId) return {};

        if (params.intent === "release") yield* closeSession(session);
        else if (session.turn && !session.turn.ended) {
          const turn = session.turn;
          turn.interrupted = true;
          tools.resolvePendingToolCalls(turn, "The turn was interrupted.");
          yield* cancelRun(session, turn);
          finish(session, turn, "interrupted");
        }

        if (params.intent !== "release") yield* closeSession(session);

        return {};
      }

      case "thread/discard": {
        const params = request.params;
        const session = sessions.get(params.threadId);

        if (session && session.agent.agentId === params.providerThreadId)
          yield* closeSession(session);

        return {};
      }

      case "model/list": {
        const params = request.params;
        const { profile } = optionsSchema.parse(params.providerOptions);
        const apiKey = yield* key(profile);

        return yield* modelCache.get(dataDir, profile, apiKey);
      }

      case "provider/health": {
        const params = request.params;
        const { profile } = optionsSchema.parse(params.providerOptions);
        const status = yield* installationStatus(dataDir);

        const health: ProviderHealth = {
          status: status.installed ? "ready" : "not_installed",
          installedVersion: status.currentVersion,
          minimumSupportedVersion: SDK_VERSION,
          canInstall: !status.installed,
          canUpdate: status.needsUpdate,
          accountEmail: null,
          loginCommand: null,
          planLabel: null,
          statusMessage: status.installed
            ? null
            : "Install the pinned Cursor SDK runtime on this host.",
        };

        if (status.installed)
          yield* Effect.gen(function* () {
            const sdk = yield* load(dataDir);
            const apiKey = yield* key(profile);
            const user = yield* foreign(() => sdk.Cursor.me({ apiKey }));
            health.accountEmail = user.userEmail ?? null;
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                health.status = "unauthenticated";
                health.statusMessage = error.message;
              }),
            ),
          );

        return { supported: true, health };
      }

      case "provider/installation/status":
        return yield* installationStatus(dataDir);
      case "provider/installation/run":
        return {
          available: true,
          command: installCommand(dataDir),
          verification: { kind: "installed" },
        };
      case "provider/usage":
        return { supported: false };
    }
  });

  const shutdown = () => {
    closing = true;
    modelCache.close();

    for (const controller of requests) controller.abort();

    return Effect.runPromise(
      Effect.forEach([...sessions.values()], closeSession, { concurrency: "unbounded" }).pipe(
        Effect.catchCause(() => Effect.void),
      ),
    );
  };

  const supported = new Set([
    "initialize",
    "thread/start",
    "thread/resume",
    "thread/fork",
    "thread/stop",
    "thread/discard",
    "turn/start",
    "turn/steer",
    "model/list",
    "provider/health",
    "provider/usage",
    "provider/installation/status",
    "provider/installation/run",
  ]);

  const bridge = experimental_defineProviderBridge({
    start(context) {
      dataDir = context.dataDir;
    },
    handleLine(line) {
      let message: unknown;

      try {
        message = JSON.parse(line);
      } catch {
        io.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } });

        return;
      }

      const response = decodeBridgeJsonRpcResponse(message);

      if (response) {
        tools.handleToolCallResponse(response);

        return;
      }

      const envelope = bridgeRequestEnvelopeSchema.safeParse(message);

      if (!envelope.success) {
        io.send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid JSON-RPC request" },
        });

        return;
      }

      const request = envelope.data;

      if (!supported.has(request.method)) {
        io.sendError(request.id, -32601, `Unsupported method: ${request.method}`);

        return;
      }

      const parsed = requestSchema.safeParse(request);

      if (!parsed.success) {
        io.sendError(request.id, -32602, safeMessage(parsed.error));

        return;
      }

      const controller = new AbortController();
      requests.add(controller);
      void Effect.runPromise(
        handle(parsed.data).pipe(
          Effect.matchCause({
            onSuccess: (result) => io.sendResult(request.id, result),
            onFailure: (cause) => {
              const value = Cause.squash(cause);
              io.sendError(
                request.id,
                value instanceof experimental_BridgeRecoveryError
                  ? value.code
                  : value instanceof z.ZodError
                    ? -32602
                    : -32603,
                safeMessage(value),
                value instanceof experimental_BridgeRecoveryError
                  ? { recovery: value.recovery }
                  : { recovery: sdkRecovery(sdkError(value)) },
              );
            },
          }),
          Effect.ensuring(Effect.sync(() => requests.delete(controller))),
        ),
        { signal: controller.signal },
      ).catch(() => {});
    },
    onClose: shutdown,
    onSigterm: shutdown,
    onSigint: shutdown,
  });

  return { ...bridge, onClose: shutdown };
}
