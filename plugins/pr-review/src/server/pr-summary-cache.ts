import { Cache, Duration, Effect, Exit, Schema, Semaphore } from "effect";
import { completionTime, prSummarySchema } from "../shared/links-contract";
import { decodeSchema, type BackendError } from "./server-effects";

type Summary = typeof prSummarySchema.Type;

const keySchema = Schema.fromJsonString(
  Schema.Struct({ hostId: Schema.String, url: Schema.String }),
);

/** Share authenticated host lookups; only a confirmed merge is immutable. */
export function createPrSummaryCache(
  lookup: (hostId: string, url: string) => Effect.Effect<Summary, BackendError>,
) {
  const requests = Semaphore.makeUnsafe(8);

  const cache = Effect.runSync(
    Cache.makeWith(
      (key: string) =>
        Effect.gen(function* () {
          const { hostId, url } = yield* decodeSchema("PR cache key", keySchema)(key);

          return yield* lookup(hostId, url).pipe(Semaphore.withPermit(requests));
        }),
      {
        capacity: 1000,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) &&
          exit.value.state === "MERGED" &&
          completionTime(exit.value) !== null
            ? Duration.infinity
            : Duration.zero,
      },
    ),
  );

  const key = (hostId: string, url: string) => JSON.stringify({ hostId, url });

  return {
    get: (hostId: string, url: string) => Cache.get(cache, key(hostId, url)),
    observe: (hostId: string, summary: Summary) =>
      summary.state === "MERGED" && completionTime(summary) !== null
        ? Cache.set(cache, key(hostId, summary.url), summary)
        : Cache.invalidate(cache, key(hostId, summary.url)),
  };
}
