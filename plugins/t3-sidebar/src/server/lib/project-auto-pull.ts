import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Context, Effect, Layer, Schema } from "effect";
const exec = promisify(execFile);

export class PullError extends Schema.TaggedError<PullError>()("PullError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}
export class PullGit extends Context.Service<
  PullGit,
  {
    run: (path: string, args: string[]) => Effect.Effect<string, PullError>;
  }
>()("sidebar/PullGit") {}
export const pullGitLive = Layer.succeed(
  PullGit,
  PullGit.of({
    run: Effect.fn("PullGit.run")((path: string, args: string[]) =>
      Effect.tryPromise({
        try: async (signal) =>
          (
            await exec("git", args, {
              cwd: path,
              signal,
              timeout: 20_000,
              maxBuffer: 1024 * 1024,
              env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
            })
          ).stdout.trim(),
        catch: (cause) => new PullError({ message: String(cause), cause }),
      }),
    ),
  }),
);
export const pullCleanDefaultBranch = Effect.fn("ProjectAutoPull.pull")(function* (path: string) {
  const commands = yield* PullGit;
  const git = (...args: string[]) => commands.run(path, args);
  // An ineligible checkout is a normal skip; interruption is never recovered.
  const optional = (read: Effect.Effect<string, PullError>) =>
    read.pipe(
      Effect.catchTag("PullError", (error) => {
        const cause = error.cause;
        return typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          (cause.code === 1 || cause.code === 128)
          ? Effect.succeed("")
          : Effect.fail(error);
      }),
    );
  // Stay on the checkout's configured remote default; never switch branches.
  const branch = yield* optional(git("symbolic-ref", "--quiet", "HEAD"));
  if (!branch) return { pulled: false };
  const upstream = yield* optional(
    git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"),
  );
  if (!upstream) return { pulled: false };
  const remote = yield* git(
    "config",
    "--get",
    `branch.${branch.replace(/^refs\/heads\//, "")}.remote`,
  );
  if (!remote || remote === ".") return { pulled: false };
  const remoteHead = yield* optional(git("symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`));
  if (!remoteHead) return { pulled: false };
  if (
    `refs/remotes/${upstream}` !== remoteHead ||
    branch.replace("refs/heads/", "") !== remoteHead.replace(`refs/remotes/${remote}/`, "")
  )
    return { pulled: false };
  if (yield* git("status", "--porcelain")) return { pulled: false };
  if ((yield* git("rev-list", "--count", "@{upstream}..HEAD")) !== "0") return { pulled: false };
  yield* git("fetch", "--no-tags", "--", remote);
  if (yield* git("status", "--porcelain")) return { pulled: false };
  if ((yield* git("symbolic-ref", "--quiet", "HEAD")) !== branch) return { pulled: false };
  if ((yield* git("rev-list", "--count", "@{upstream}..HEAD")) !== "0") return { pulled: false };
  yield* git("merge", "--ff-only", "--", upstream);
  return { pulled: true };
});
