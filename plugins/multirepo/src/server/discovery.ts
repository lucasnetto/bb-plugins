import { join, relative } from "node:path";
import { Context, Effect, Schema } from "effect";
import type { Repo } from "../shared/contract";

export class DiscoveryError extends Schema.TaggedError<DiscoveryError>()("DiscoveryError", {
  path: Schema.String,
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export class DiscoveryIO extends Context.Service<
  DiscoveryIO,
  {
    realpath: (path: string) => Effect.Effect<string, DiscoveryError>;
    entries: (
      path: string,
    ) => Effect.Effect<ReadonlyArray<{ name: string; isDirectory: () => boolean }>, DiscoveryError>;
    snapshot: (path: string) => Effect.Effect<Omit<Repo, "name" | "error">, DiscoveryError>;
  }
>()("multirepo/DiscoveryIO") {}

export const discoverRepositories = Effect.fn("Multirepo.discover")(function* (root: string) {
  const io = yield* DiscoveryIO;
  const base = yield* io.realpath(root);
  const paths: string[] = [];
  const visit = Effect.fn("Multirepo.visit")(function* (
    path: string,
  ): Effect.fn.Return<void, DiscoveryError> {
    const entries = yield* io.entries(path);
    if (entries.some((entry) => entry.name === ".git")) {
      paths.push(path);
      return;
    }
    // Stop at repository roots, including worktrees; never follow symlinks.
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !["node_modules", "vendor", "target", "dist", "build"].includes(entry.name)
      ) {
        yield* visit(join(path, entry.name));
      }
    }
  });
  yield* visit(base);
  const repos = yield* Effect.forEach(
    paths,
    (path) => {
      const name = relative(base, path) || ".";
      return io.snapshot(path).pipe(
        Effect.map((snapshot): Repo => ({ ...snapshot, name, error: null })),
        Effect.catchTag("DiscoveryError", (error) =>
          Effect.succeed<Repo>({
            name,
            branch: "",
            remote: null,
            changes: 0,
            error: `${error.operation}: ${error.message}`,
          }),
        ),
      );
    },
    { concurrency: 4 },
  );
  return repos.sort((a, b) => a.name.localeCompare(b.name));
});
