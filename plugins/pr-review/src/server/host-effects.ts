import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Context, Effect, Layer, Schema } from "effect";

// Reserve half of the host's 8 MiB transport limit for JSON escaping/metadata.
export const MAX_BYTES = 4 * 1024 * 1024;
export class CommandError extends Schema.TaggedError<CommandError>()("CommandError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
}) {}
export class InputError extends Schema.TaggedError<InputError>()("InputError", {
  message: Schema.String,
}) {}

export type Command = (
  cwd: string,
  program: string,
  args: string[],
  signal?: AbortSignal,
) => Promise<string>;
export class Commands extends Context.Service<
  Commands,
  {
    run: (cwd: string, program: string, args: string[]) => Effect.Effect<string, CommandError>;
  }
>()("pr-review/Commands") {}

const exec = promisify(execFile);
const nativeCommand: Command = async (cwd, program, args, signal) => {
  const { stdout } = await exec(program, args, {
    cwd,
    signal,
    encoding: "utf8",
    maxBuffer: MAX_BYTES,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
    },
  });
  return stdout;
};
export const commandLayer = (run: Command = nativeCommand) =>
  Layer.succeed(
    Commands,
    Commands.of({
      run: Effect.fn("Commands.run")((cwd: string, program: string, args: string[]) =>
        Effect.tryPromise({
          try: (signal) => run(cwd, program, args, signal),
          catch: (cause) =>
            new CommandError({
              operation: `${program} ${args.join(" ")}`,
              message: String(cause),
              cause,
            }),
        }),
      ),
    }),
  );
const live = commandLayer();
export const command = Effect.fn("Host.command")(function* (
  cwd: string,
  program: string,
  args: string[],
) {
  return yield* (yield* Commands).run(cwd, program, args);
});
// Classify failures from non-schema parsers such as PR URLs.
export const decode = <A>(read: () => A) =>
  Effect.try({
    try: read,
    catch: (cause) => new InputError({ message: String(cause) }),
  });
export const invalid = (message: string) => Effect.fail(new InputError({ message }));
export const runHost = <A, E>(
  effect: Effect.Effect<A, E, Commands>,
  signal?: AbortSignal,
  run?: Command,
) => {
  if (signal?.aborted) return Promise.reject<A>(signal.reason);
  return Effect.runPromise(effect.pipe(Effect.provide(run ? commandLayer(run) : live)), { signal });
};

export const decodeSchema = Effect.fn("Host.decode")(
  <S extends Schema.Constraint>(schema: S, input: unknown) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError((cause) => new InputError({ message: cause.message })),
    ),
);
