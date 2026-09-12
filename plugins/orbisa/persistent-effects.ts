import { Effect, Schema } from "effect";

export class PersistentError extends Schema.TaggedError<PersistentError>()("PersistentError", {
  message: Schema.String,
}) {}
// Foreign SDK/OS errors may contain credentials; report only deliberate context.
export const foreign = <A>(message: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new PersistentError({ message }) });
export const parse = <A>(run: () => A) =>
  Effect.try({
    try: run,
    catch: () => new PersistentError({ message: "Invalid persistent VM identity or profile." }),
  });
