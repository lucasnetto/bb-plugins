import { reasoningLevelSchema } from "@get-bb/plugin-sdk/provider-bridge";
import { Cache, Effect, Exit } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { legacyModelCatalog, modelCatalog } from "./models.js";
import { foreign, profileSchema, type Profile, type SdkError } from "./operations.js";
import { SDK_VERSION, type SdkModule } from "./runtime.js";

const modelSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  defaultReasoningEffort: reasoningLevelSchema,
  supportedReasoningEfforts: z.array(
    z.object({ reasoningEffort: reasoningLevelSchema, description: z.string() }),
  ),
});

const catalogSchema = z.object({
  models: z.array(modelSchema).min(1),
  selectedOnlyModels: z.array(modelSchema),
});

const lookupSchema = z.object({ dataDir: z.string(), profile: profileSchema, apiKey: z.string() });

// Cache keys contain credentials only in process memory. Disk paths contain a
// digest, and files contain only the validated catalog, never the API key.
export function createModelCache(
  load: (
    dataDir: string,
  ) => Effect.Effect<{ Cursor: Pick<SdkModule["Cursor"], "models"> }, SdkError>,
) {
  const controllers = new Set<AbortController>();
  let closed = false;

  const fileFor = (dataDir: string, profile: Profile, apiKey: string) =>
    join(
      dataDir,
      "model-catalogs",
      `v1-${SDK_VERSION}-${profile}-${createHash("sha256").update(apiKey).digest("hex")}.json`,
    );

  const refresh = Effect.fn("CursorSdk.refreshModels")(function* (cacheKey: string) {
    const { dataDir, profile, apiKey } = lookupSchema.parse(JSON.parse(cacheKey));
    const sdk = yield* load(dataDir);
    const sdkModels = yield* foreign(() => sdk.Cursor.models.list({ apiKey }));
    const models = modelCatalog(sdkModels);

    const catalog = yield* foreign(async () =>
      catalogSchema.parse({ models, selectedOnlyModels: legacyModelCatalog(sdkModels, models) }),
    );

    const file = fileFor(dataDir, profile, apiKey);
    const temporary = `${file}.${randomUUID()}.tmp`;

    // A read-only/full disk must not turn a successful API response into an error.
    yield* foreign(async () => {
      try {
        await mkdir(join(dataDir, "model-catalogs"), { recursive: true });
        await writeFile(temporary, JSON.stringify(catalog), { mode: 0o600 });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    }).pipe(Effect.catch(() => Effect.void));

    return catalog;
  });

  const cache = Effect.runSync(
    Cache.makeWith(refresh, {
      capacity: 4,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? "10 minutes" : "30 seconds"),
    }),
  );

  const get = Effect.fn("CursorSdk.cachedModels")(function* (
    dataDir: string,
    profile: Profile,
    apiKey: string,
  ) {
    const cacheKey = JSON.stringify({ dataDir, profile, apiKey });

    const saved = yield* foreign(async () =>
      catalogSchema.parse(JSON.parse(await readFile(fileFor(dataDir, profile, apiKey), "utf8"))),
    ).pipe(Effect.catch(() => Effect.succeed(null)));

    const lookup = Cache.get(cache, cacheKey);

    if (!saved) return yield* lookup;

    if (!closed) {
      const controller = new AbortController();
      controllers.add(controller);
      // This refresh outlives the model/list RPC, but is owned by the bridge.
      void Effect.runPromise(lookup, { signal: controller.signal })
        .catch(() => undefined)
        .finally(() => controllers.delete(controller));
    }

    return saved;
  });

  return {
    get,
    close() {
      closed = true;

      for (const controller of controllers) controller.abort();
    },
  };
}
