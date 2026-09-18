import type {
  AgentOptions,
  SendOptions,
  SDKAgent,
  SDKCustomTool,
  SDKImage,
  SDKModel,
  Run,
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
  providerTurnId?: string;
  pending: TurnParams[];
  options: TurnParams["options"];
  steers: Set<Deferred.Deferred<void>>;
  steerFibers: Set<Fiber.Fiber<void, never>>;
  events: RunEvents;
  interrupted: boolean;
  cancelRequested: boolean;
  ended: boolean;
  fiber?: Fiber.Fiber<void, never>;
};

type Session = {
  cloud?: CloudSession;
  models: SDKModel[];
  threadId: string;
  agent: SDKAgent;
  instructions?: string;
  lastInstructions?: string;
  customTools: Record<string, SDKCustomTool>;
  env: Record<string, string>;
  turn?: TurnState;
  released: boolean;
};

export interface BridgeDependencies {
  load: (dataDir: string) => Effect.Effect<SdkModule, SdkError>;
  key: (profile: Profile) => Effect.Effect<string, SdkError>;
  source: (cwd: string) => Effect.Effect<CloudSource, SdkError>;
}

export function createSdkBridge(
  dependencies: Partial<BridgeDependencies> = {},
  write?: (line: string) => void,
) {
  const load = dependencies.load ?? loadSdk;
  const key = dependencies.key ?? readApiKey;
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
  ): Record<string, SDKCustomTool> =>
    Object.fromEntries(
      definitions.map((definition) => [
        definition.name,
        {
          description: definition.description,
          inputSchema: z.record(z.string(), z.json()).parse(definition.inputSchema),
          execute: (args) =>
            Effect.runPromise(
              foreign(() =>
                tools.forwardToolCall({
                  arguments: args,
                  providerThreadId: session.agent.agentId,
                  threadId: session.threadId,
                  toolName: definition.name,
                  scope: session,
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
            ),
        } satisfies SDKCustomTool,
      ]),
    );

  const closeSession = Effect.fn("CursorSdk.closeSession")(function* (session: Session) {
    session.released = true;

    if (session.turn) yield* Effect.forEach([...session.turn.steerFibers], Fiber.interrupt);
    tools.resolvePendingToolCalls(session, "The Cursor SDK session was released.");
    yield* Effect.gen(function* () {
      if (session.turn && !session.turn.ended) {
        session.turn.interrupted = true;
        const run = session.turn.run;

        if (run && !session.cloud) yield* foreign(() => run.cancel());
      }
    }).pipe(
      Effect.ensuring(
        foreign(() => session.agent[Symbol.asyncDispose]()).pipe(Effect.catch(() => Effect.void)),
      ),
      Effect.ensuring(
        Effect.gen(function* () {
          if (session.turn?.fiber) yield* Fiber.interrupt(session.turn.fiber);
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
      if (params.sourceProviderCheckpointId !== undefined)
        return yield* Effect.fail(
          new SdkError({
            message: "Cursor SDK supports forking only from the latest saved state.",
          }),
        );

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
      const sdk = yield* load(dataDir);
      const apiKey = yield* key(profile);
      const models = yield* foreign(() => sdk.Cursor.models.list({ apiKey }));

      const model = params.options.model
        ? resolveModel(
            params.options.model,
            models,
            params.options.reasoningLevel,
            params.options.serviceTier,
          )
        : undefined;

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
      const store = new sdk.JsonlLocalAgentStore(join(dataDir, "conversations", profile));

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
        ? yield* openCloudSession({
            sdk,
            dataDir,
            profile,
            threadId: params.threadId,
            options: { apiKey, model, mode: options.mode },
            source: () => (dependencies.source ?? readCloudSource)(params.cwd),
            providerThreadId:
              "providerThreadId" in params ? String(params.providerThreadId) : undefined,
          })
        : undefined;

      const agent = cloud
        ? cloud.agent
        : "sourceProviderThreadId" in params
          ? yield* forkLocalAgent(store, String(params.sourceProviderThreadId), params.cwd, (id) =>
              sdk.Agent.resume(id, options),
            )
          : "providerThreadId" in params
            ? yield* foreign(() => sdk.Agent.resume(String(params.providerThreadId), options))
            : yield* foreign(() => sdk.Agent.create(options));

      const session: Session = {
        cloud,
        models,
        threadId: params.threadId,
        agent,
        instructions:
          params.instructionMode === "replace" ? undefined : params.options.instructions,
        customTools: {},
        env,
        released: false,
      };

      if (!isCloud) session.customTools = customTools(params.dynamicTools ?? [], session);
      sessions.set(params.threadId, session);
      io.send({
        jsonrpc: "2.0",
        method: "thread/identity",
        params: { threadId: params.threadId, providerThreadId: agent.agentId },
      });
      emit(params.threadId, [{ kind: "session.reset" }]);

      return { providerThreadId: agent.agentId };
    }).pipe(Effect.ensuring(Effect.sync(() => constructing.delete(params.threadId))));
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
            detail: JSON.stringify({ isRetryable: error.isRetryable, requestId: error.requestId }),
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

    if (!session.cloud) sendOptions.local = { customTools: session.customTools };

    const run = yield* foreign(() =>
      session.agent.send(input.message, sendOptions).then(async (run) => {
        // Stop can arrive while Cursor is still creating the run. Keep cleanup
        // attached to the SDK promise even if BB interrupts the waiting fiber.
        turn.run = run;

        if (turn.cancelRequested || (session.released && !session.cloud)) await run.cancel();

        if (session.released) await session.agent[Symbol.asyncDispose]();

        return run;
      }),
    );

    turn.run = run;
    const firstRun = turn.providerTurnId === undefined;
    turn.providerTurnId ??= run.id;

    if (session.cloud) yield* session.cloud.markCreated();

    if (firstRun)
      emit(session.threadId, [{ kind: "turn.open", providerTurnId: turn.providerTurnId }]);
    acceptInput(session, turn);
    session.lastInstructions = input.instructions;

    if (turn.interrupted || session.released) {
      finish(session, turn, "interrupted");

      return;
    }

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

    if (!turn.ended && !session.released) {
      turn.events.finish(result);

      if (session.cloud && result.git?.branches.length)
        cloudNote(cloudRunSummary(session.agent.agentId, session.cloud.source, result));
    }

    // A run can finish before Cursor acknowledges an in-flight steer. Keep
    // its BB turn open until delivery ownership has been resolved.
    while (turn.steers.size)
      yield* Effect.forEach([...turn.steers], (pending) => Deferred.await(pending));

    const next = turn.pending.shift();

    if (next && !turn.interrupted && !session.released) {
      turn.clientRequestId = next.clientRequestId;
      turn.accepted = false;

      return yield* executeTurn(next, session, turn);
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
        events: new RunEvents((deltas) => {
          if (!session.released)
            emit(
              session.threadId,
              deltas.map((delta) => ({ ...delta, providerTurnId: turn.providerTurnId })),
            );
        }),
        interrupted: false,
        cancelRequested: false,
        ended: false,
      };

      const previous = session.turn?.fiber;
      session.turn = turn;
      turn.fiber = Effect.runFork(
        (previous ? Fiber.join(previous) : Effect.void).pipe(
          Effect.andThen(executeTurn(params, session, turn)),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              const run = turn.run;

              if (run && !turn.interrupted && !session.released)
                yield* foreign(() => run.cancel()).pipe(Effect.catch(() => Effect.void));
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
          fork: "tip",
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
          turn.cancelRequested = true;
          tools.resolvePendingToolCalls(session, "The turn was interrupted.");
          const run = turn.run;

          if (run) yield* foreign(() => run.cancel());
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
    void Effect.runPromise(
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

  return experimental_defineProviderBridge({
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
}
