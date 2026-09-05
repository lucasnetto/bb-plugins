import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";

export class BackendError extends Schema.TaggedError<BackendError>()("BackendError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
}) {}
export const call = Effect.fn("Backend.call")(
  <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new BackendError({
          operation,
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }),
);
export const sync = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) =>
      new BackendError({
        operation,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
export function createRuntime(bb: BbPluginApi) {
  const runtime = ManagedRuntime.make(Layer.empty);
  // Disposal interrupts in-flight work and waits for Effect finalizers.
  bb.onDispose(() => runtime.dispose());
  return runtime;
}

// Convert to Promise only when handing an operation to a BB entry point.
export const handler =
  <Args extends readonly unknown[], A, E>(
    runtime: ManagedRuntime.ManagedRuntime<never, never>,
    operation: (...args: Args) => Effect.Effect<A, E>,
  ) =>
  (...args: Args) =>
    runtime.runPromise(operation(...args));

export const decodeSchema = Effect.fn("Backend.decode")(
  <S extends Schema.Constraint>(operation: string, schema: S, input: unknown) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError((cause) => new BackendError({ operation, message: cause.message, cause })),
    ),
);
