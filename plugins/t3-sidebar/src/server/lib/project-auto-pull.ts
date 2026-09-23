import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Context, Effect, Layer, Schema } from "effect";

const exec = promisify(execFile);

const isIneligibleCheckout = Schema.is(Schema.Struct({ code: Schema.Literals([1, 128]) }));

export class PullError extends Schema.TaggedError<PullError>()("PullError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const skippedDirectories = new Set(["node_modules", "vendor", "target", "dist", "build"]);

export const discoverProjectRepositories = Effect.fn("ProjectAutoPull.discover")((root: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const paths: string[] = [];
      const errors: { path: string; message: string }[] = [];

      async function walk(path: string) {
        signal.throwIfAborted();

        const entries = await readdir(path, { withFileTypes: true }).catch((error) => {
          errors.push({ path, message: String(error) });

          return [];
        });

        signal.throwIfAborted();
        const marker = entries.find((entry) => entry.name === ".git");

        if (marker) {
          if (marker.isDirectory() || marker.isFile()) paths.push(path);

          // A checkout is a boundary: never update its submodules independently.
          return;
        }

        // Bare repositories have no checkout to update or directories to discover.
        if (
          entries.some((entry) => entry.name === "HEAD" && entry.isFile()) &&
          entries.some((entry) => entry.name === "objects" && entry.isDirectory()) &&
          entries.some((entry) => entry.name === "refs" && entry.isDirectory())
        )
          return;

        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            !skippedDirectories.has(entry.name)
          )
            await walk(join(path, entry.name));
        }
      }

      await walk(root);

      return { paths, errors };
    },
    catch: (cause) => new PullError({ message: String(cause), cause }),
  }),
);

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
        return isIneligibleCheckout(error.cause) ? Effect.succeed("") : Effect.fail(error);
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
