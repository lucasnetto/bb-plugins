import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Deferred, Effect, Fiber, Queue } from "effect";
import { createPrSummaryCache } from "../../src/server/pr-summary-cache";
import { BackendError } from "../../src/server/server-effects";
import { parsePrUrl } from "../../src/shared/links-contract";

const url = "https://github.com/org/api/pull/42";

const merged = {
  ...parsePrUrl(url),
  title: "Done",
  state: "MERGED" as const,
  isDraft: false,
  mergedAt: "2026-09-15T12:00:00Z",
};

test("overlapping callers share one lookup and a confirmed merge remains cached", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      let calls = 0;

      const cache = createPrSummaryCache(() =>
        Effect.gen(function* () {
          calls++;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);

          return merged;
        }),
      );

      const requests = yield* Effect.forkChild(
        Effect.all([cache.get("host", url), cache.get("host", url)], { concurrency: 2 }),
      );

      yield* Deferred.await(started);
      yield* Effect.yieldNow;
      assert.equal(calls, 1);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(requests);
      assert.equal(calls, 1);
      yield* cache.get("host", url);
      assert.equal(calls, 1);
      yield* cache.get("different-host", url);
      assert.equal(calls, 2);
    }),
  );
});

test("mutable states and failures are rechecked; observed merges avoid another network call", async () => {
  let calls = 0;
  let fail = true;

  const cache = createPrSummaryCache(() =>
    Effect.suspend(() => {
      calls++;

      return fail
        ? Effect.fail(new BackendError({ operation: "test", message: "offline", cause: null }))
        : Effect.succeed({
            ...merged,
            state: "CLOSED",
            mergedAt: null,
            closedAt: "2026-09-15T12:00:00Z",
          });
    }),
  );

  await assert.rejects(Effect.runPromise(cache.get("host", url)));
  fail = false;
  await Effect.runPromise(cache.get("host", url));
  await Effect.runPromise(cache.get("host", url));
  assert.equal(calls, 3);
  await Effect.runPromise(cache.observe("host", merged));
  assert.equal((await Effect.runPromise(cache.get("host", url))).state, "MERGED");
  assert.equal(calls, 3);
  await Effect.runPromise(cache.observe("host", { ...merged, state: "OPEN", mergedAt: null }));
  assert.equal((await Effect.runPromise(cache.get("host", url))).state, "CLOSED");
  assert.equal(calls, 4);
});

test("GitHub summary requests are capped at eight concurrent lookups", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const started = yield* Queue.unbounded<void>();
      let active = 0;
      let maximum = 0;

      const cache = createPrSummaryCache(() =>
        Effect.gen(function* () {
          active++;
          maximum = Math.max(maximum, active);
          yield* Queue.offer(started, undefined);
          yield* Deferred.await(release);
          active--;

          return merged;
        }),
      );

      const requests = yield* Effect.forkChild(
        Effect.forEach(
          Array.from({ length: 12 }, (_, i) => i),
          (i) => cache.get("host", `${url}${i}`),
          { concurrency: 12 },
        ),
      );

      for (let i = 0; i < 8; i++) yield* Queue.take(started);
      assert.equal(active, 8);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(requests);
      assert.equal(maximum, 8);
    }),
  );
});
