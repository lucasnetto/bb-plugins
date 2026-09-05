import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { DiscoveryError, DiscoveryIO, discoverRepositories } from "../../src/server/discovery";

const snapshot = { branch: "main", remote: null, changes: 0 };
const directory = (name: string) => ({ name, isDirectory: () => true });
const fixture = (read: DiscoveryIO["Service"]["snapshot"]) =>
  Layer.succeed(DiscoveryIO, {
    realpath: () => Effect.succeed("/workspace"),
    entries: (path) =>
      Effect.succeed(
        path === "/workspace" ? ["e", "d", "c", "b", "a"].map(directory) : [directory(".git")],
      ),
    snapshot: read,
  });

test("discovery bounds concurrent reads and sorts results independently of completion", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let active = 0;
        let peak = 0;
        const layer = fixture(() =>
          Effect.gen(function* () {
            active++;
            peak = Math.max(peak, active);
            if (active === 4) yield* Deferred.succeed(ready, undefined);
            yield* Deferred.await(release);
            return snapshot;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                active--;
              }),
            ),
          ),
        );
        const fiber = yield* discoverRepositories("/workspace").pipe(
          Effect.provide(layer),
          Effect.forkScoped,
        );
        yield* Deferred.await(ready);
        assert.equal(active, 4);
        yield* Deferred.succeed(release, undefined);
        const repos = yield* Fiber.join(fiber);
        assert.equal(peak, 4);
        assert.equal(active, 0);
        assert.deepEqual(
          repos.map((repo) => repo.name),
          ["a", "b", "c", "d", "e"],
        );
      }),
    ),
  ));

test("a repository failure produces one error row while other repositories succeed", async () => {
  const layer = fixture((path) =>
    path.endsWith("/c")
      ? Effect.fail(
          new DiscoveryError({
            path,
            operation: "git status",
            message: "unreadable repository",
            cause: null,
          }),
        )
      : Effect.succeed(snapshot),
  );
  const repos = await Effect.runPromise(
    discoverRepositories("/workspace").pipe(Effect.provide(layer)),
  );
  assert.equal(repos.length, 5);
  assert.deepEqual(
    repos.filter((repo) => repo.error !== null),
    [
      {
        name: "c",
        branch: "",
        remote: null,
        changes: 0,
        error: "git status: unreadable repository",
      },
    ],
  );
});

test("request cancellation aborts every active adapter and never becomes error rows", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const controller = new AbortController();
        let started = 0;
        let aborted = 0;
        const layer = fixture(() =>
          Effect.gen(function* () {
            started++;
            if (started === 4) yield* Deferred.succeed(ready, undefined);
            return yield* Effect.tryPromise({
              try: (signal) =>
                new Promise<typeof snapshot>((_resolve, reject) => {
                  signal.addEventListener(
                    "abort",
                    () => {
                      aborted++;
                      reject(new Error("aborted"));
                    },
                    { once: true },
                  );
                }),
              catch: (cause) =>
                new DiscoveryError({ path: "test", operation: "read", message: "aborted", cause }),
            });
          }),
        );
        const result = Effect.runPromise(
          discoverRepositories("/workspace").pipe(Effect.provide(layer)),
          { signal: controller.signal },
        );
        // Attach the rejection assertion before aborting to avoid an unhandled rejection.
        const rejected = assert.rejects(result);
        yield* Deferred.await(ready);
        controller.abort();
        yield* Effect.promise(() => rejected);
        assert.equal(started, 4);
        assert.equal(aborted, 4);
      }),
    ),
  ));
