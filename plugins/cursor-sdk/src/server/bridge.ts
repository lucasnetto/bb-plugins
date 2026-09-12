import type { SDKAgent, SDKCustomTool, SDKImage, SDKModel, Run } from "@cursor/sdk";
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
  threadStopParamsSchema,
  threadDiscardParamsSchema,
  turnStartParamsSchema,
  mimeTypeFromExtension,
  type ThreadDelta,
  type DynamicTool,
  type ProviderHealth,
} from "@get-bb/plugin-sdk/provider-bridge";
import { Cause, Effect, Fiber, Stream } from "effect";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  foreign,
  readApiKey,
  safeMessage,
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
import { resolveModel, modelCatalog, legacyModelCatalog } from "./models.js";
import { RunEvents } from "./events.js";

type StartParams = z.infer<typeof threadStartParamsSchema>;
type ResumeParams = z.infer<typeof threadResumeParamsSchema>;
type TurnParams = z.infer<typeof turnStartParamsSchema>;
type Options = StartParams["options"];
type TurnState = {
  clientRequestId: string;
  accepted: boolean;
  run?: Run;
  events: RunEvents;
  interrupted: boolean;
  ended: boolean;
  fiber?: Fiber.Fiber<void, never>;
};
type Session = {
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
}

export function createSdkBridge(
  dependencies: Partial<BridgeDependencies> = {},
  write?: (line: string) => void,
) {
  const load = dependencies.load ?? loadSdk;
  const key = dependencies.key ?? readApiKey;
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
    tools.resolvePendingToolCalls(session, "The Cursor SDK session was released.");
    yield* Effect.gen(function* () {
      if (session.turn && !session.turn.ended) {
        session.turn.interrupted = true;
        const run = session.turn.run;
        if (run) yield* foreign(() => run.cancel());
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
    params: StartParams | ResumeParams,
  ) {
    checkOptions(params.options);
    if (constructing.has(params.threadId) || sessions.has(params.threadId)) {
      return yield* Effect.fail(
        new SdkError({ message: "Release this SDK session before opening it again." }),
      );
    }
    constructing.add(params.threadId);
    return yield* Effect.gen(function* () {
      const { profile } = optionsSchema.parse(params.options.providerOptions);
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
      const env = { ...params.options.envVars, CURSOR_API_KEY: apiKey };
      if (
        [...sessions.values()].some(
          (session) => JSON.stringify(session.env) !== JSON.stringify(env),
        )
      ) {
        return yield* Effect.fail(
          new SdkError({
            message:
              "SDK sessions with different environments require separate provider bridge processes.",
          }),
        );
      }
      Object.assign(process.env, env);
      const store = new sdk.JsonlLocalAgentStore(join(dataDir, "conversations", profile));
      const options = {
        apiKey,
        model,
        local: { cwd: params.cwd, store },
        mode: params.options.promptMode === "plan" ? ("plan" as const) : ("agent" as const),
        ...(params.disallowedTools?.length ? { disallowedTools: params.disallowedTools } : {}),
        ...(params.instructionMode === "replace" && params.options.instructions
          ? { systemPrompt: params.options.instructions }
          : {}),
      };
      const agent =
        "providerThreadId" in params
          ? yield* foreign(() => sdk.Agent.resume(String(params.providerThreadId), options))
          : yield* foreign(() => sdk.Agent.create(options));
      const session: Session = {
        models,
        threadId: params.threadId,
        agent,
        instructions:
          params.instructionMode === "replace" ? undefined : params.options.instructions,
        customTools: {},
        env,
        released: false,
      };
      session.customTools = customTools(params.dynamicTools ?? [], session);
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
      else if (input.type === "localFile") text.push(`Attached file: ${input.path}`);
    }
    if (images.length > 5)
      return yield* Effect.fail(
        new SdkError({ message: "Cursor SDK supports up to five images per message." }),
      );
    return {
      message: { text: text.join("\n\n"), ...(images.length ? { images } : {}) },
      instructions,
    };
  });

  const acceptInput = (session: Session, turn: TurnState) => {
    if (turn.accepted || session.released) return;
    turn.accepted = true;
    emit(session.threadId, [
      {
        kind: "input.accepted",
        clientRequestId: turn.clientRequestId,
        providerTurnId: turn.run?.id,
      },
    ]);
  };

  const finish = (
    session: Session,
    turn: TurnState,
    status: "completed" | "failed" | "interrupted",
    message?: string,
  ) => {
    if (turn.ended) return;
    acceptInput(session, turn);
    turn.events.close(status);
    turn.ended = true;
    if (!session.released)
      emit(session.threadId, [
        {
          kind: "turn.boundary",
          status,
          providerTurnId: turn.run?.id,
          claimIfIdle: true,
          ...(message ? { error: { message } } : {}),
        },
      ]);
  };

  const executeTurn = Effect.fn("CursorSdk.executeTurn")(function* (
    params: TurnParams,
    session: Session,
    turn: TurnState,
  ) {
    if (session.released || turn.interrupted) return;
    const input = yield* prompt(params, session);
    const run = yield* foreign(() =>
      session.agent.send(input.message, {
        ...(params.options.model
          ? {
              model: resolveModel(
                params.options.model,
                session.models,
                params.options.reasoningLevel,
                params.options.serviceTier,
              ),
            }
          : {}),
        mode: params.options.promptMode === "plan" ? "plan" : "agent",
        local: { customTools: session.customTools },
        idempotencyKey: params.clientRequestId,
      }),
    );
    turn.run = run;
    acceptInput(session, turn);
    session.lastInstructions = input.instructions;
    if (turn.interrupted || session.released) {
      yield* foreign(() => run.cancel());
      finish(session, turn, "interrupted");
      return;
    }
    emit(session.threadId, [{ kind: "turn.open", providerTurnId: run.id }]);
    yield* Stream.fromAsyncIterable(
      run.stream(),
      (error) => new SdkError({ message: safeMessage(error) }),
    ).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (!turn.ended && !session.released) turn.events.accept(event);
        }),
      ),
    );
    const result = yield* foreign(() => run.wait());
    if (!turn.ended && !session.released) turn.events.finish(result);
    finish(
      session,
      turn,
      result.status === "cancelled"
        ? "interrupted"
        : result.status === "error"
          ? "failed"
          : "completed",
      result.error ? safeMessage(result.error.message) : undefined,
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
        events: new RunEvents((deltas) => {
          if (!session.released)
            emit(
              session.threadId,
              deltas.map((delta) => ({ ...delta, providerTurnId: turn.run?.id })),
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
              const run = turn.run;
              if (run && !turn.interrupted)
                yield* foreign(() => run.cancel()).pipe(Effect.catch(() => Effect.void));
              finish(
                session,
                turn,
                turn.interrupted ? "interrupted" : "failed",
                safeMessage(Cause.squash(cause)),
              );
            }),
          ),
        ),
      );
      return { accepted: true };
    });

  const handle = Effect.fn("CursorSdk.handleRequest")(function* (
    method: string,
    raw: unknown,
  ): Effect.fn.Return<unknown, SdkError> {
    if (method === "initialize") {
      const params = initializeParamsSchema.parse(raw);
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
          fork: "none",
          steerMode: "queue",
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
    switch (method) {
      case "thread/start":
        return yield* openSession(threadStartParamsSchema.parse(raw));
      case "thread/resume":
        return yield* openSession(threadResumeParamsSchema.parse(raw));
      case "turn/start":
        return yield* startTurn(turnStartParamsSchema.parse(raw));
      case "thread/stop": {
        const params = threadStopParamsSchema.parse(raw);
        const session = sessions.get(params.threadId);
        if (!session || session.agent.agentId !== params.providerThreadId) return {};
        if (params.intent === "release") yield* closeSession(session);
        else if (session.turn && !session.turn.ended) {
          const turn = session.turn;
          turn.interrupted = true;
          tools.resolvePendingToolCalls(session, "The turn was interrupted.");
          const run = turn.run;
          if (run) yield* foreign(() => run.cancel());
          finish(session, turn, "interrupted");
        }
        return {};
      }
      case "thread/discard": {
        const params = threadDiscardParamsSchema.parse(raw);
        const session = sessions.get(params.threadId);
        if (session && session.agent.agentId === params.providerThreadId)
          yield* closeSession(session);
        return {};
      }
      case "model/list": {
        const params = modelListParamsSchema.parse(raw);
        const { profile } = optionsSchema.parse(params.providerOptions);
        const sdk = yield* load(dataDir);
        const apiKey = yield* key(profile);
        const sdkModels = yield* foreign(() => sdk.Cursor.models.list({ apiKey }));
        const models = modelCatalog(sdkModels);
        return { models, selectedOnlyModels: legacyModelCatalog(sdkModels, models) };
      }
      case "provider/health": {
        const params = providerMaintenanceParamsSchema.parse(raw);
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
        providerInstallationStatusParamsSchema.parse(raw);
        return yield* installationStatus(dataDir);
      case "provider/installation/run":
        providerInstallationRunParamsSchema.parse(raw);
        return {
          available: true,
          command: installCommand(dataDir),
          verification: { kind: "installed" },
        };
      case "provider/usage":
        providerMaintenanceParamsSchema.parse(raw);
        return { supported: false };
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  });

  const shutdown = () => {
    closing = true;
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
    "thread/stop",
    "thread/discard",
    "turn/start",
    "model/list",
    "provider/health",
    "provider/usage",
    "provider/installation/status",
    "provider/installation/run",
  ]);
  const validators: Record<string, z.ZodType> = {
    initialize: initializeParamsSchema,
    "thread/start": threadStartParamsSchema,
    "thread/resume": threadResumeParamsSchema,
    "thread/stop": threadStopParamsSchema,
    "thread/discard": threadDiscardParamsSchema,
    "turn/start": turnStartParamsSchema,
    "model/list": modelListParamsSchema,
    "provider/health": providerMaintenanceParamsSchema,
    "provider/usage": providerMaintenanceParamsSchema,
    "provider/installation/status": providerInstallationStatusParamsSchema,
    "provider/installation/run": providerInstallationRunParamsSchema,
  };
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
      const parsed = validators[request.method].safeParse(request.params);
      if (!parsed.success) {
        io.sendError(request.id, -32602, safeMessage(parsed.error));
        return;
      }
      const controller = new AbortController();
      requests.add(controller);
      void Effect.runPromise(
        handle(request.method, request.params).pipe(
          Effect.matchCause({
            onSuccess: (result) => io.sendResult(request.id, result),
            onFailure: (cause) => {
              const value = Cause.squash(cause);
              io.sendError(
                request.id,
                value instanceof z.ZodError ? -32602 : -32603,
                safeMessage(value),
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
