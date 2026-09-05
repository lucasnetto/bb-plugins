// bb-plugin-hide-models — backend.
//
// Stores a per-provider denylist of models. Model discovery is untouched: the
// frontend content script hides matching rows in bb's model picker, so this is
// a UI-only filter (t3code-style "hide models from a provider").
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { Effect, Semaphore } from "effect";
import { call, sync, createRuntime } from "./server-effects";

import {
  hiddenModelSchema,
  rpcContract,
  HIDDEN_CHANGED,
  type HiddenModel,
  type CatalogProvider,
} from "../shared/contract";
const KV_KEY = "hidden";

const keyOf = (entry: HiddenModel) => `${entry.providerId}\u0000${entry.model}`;

const dedupe = (entries: HiddenModel[]): HiddenModel[] => [
  ...new Map(entries.map((entry) => [keyOf(entry), entry])).values(),
];

export default function plugin(bb: BbPluginApi) {
  const runtime = createRuntime(bb);
  const mutationLock = Semaphore.makeUnsafe(1);
  const readHidden = Effect.fn("HiddenModels.read")(function* () {
    const raw = yield* call("hidden.read", () => bb.storage.kv.get(KV_KEY));
    return yield* sync("hidden.decode", () => z.array(hiddenModelSchema).parse(raw ?? []));
  });
  const writeHidden = Effect.fn("HiddenModels.write")(function* (entries: HiddenModel[]) {
    const hidden = dedupe(entries);
    yield* call("hidden.write", () => bb.storage.kv.set(KV_KEY, hidden));
    yield* sync("hidden.publish", () =>
      bb.realtime.publish(HIDDEN_CHANGED, { count: hidden.length }),
    );
    return hidden;
  });

  const catalog = Effect.fn("HiddenModels.catalog")(function* () {
    const providers = yield* call("providers.list", () => bb.sdk.providers.list());
    return yield* Effect.forEach(
      providers,
      (provider) =>
        call("providers.models", () => bb.sdk.providers.models({ providerId: provider.id })).pipe(
          Effect.map((result): CatalogProvider => ({
            id: provider.id,
            displayName: provider.displayName,
            available: provider.available,
            brandPrefix: provider.strings?.brandPrefix ?? null,
            models: result.models.map((model) => ({
              model: model.model,
              displayName: model.displayName,
              description: model.description,
              isDefault: model.isDefault,
            })),
            loadError: result.modelLoadError?.code ?? null,
          })),
          Effect.catchTag("BackendError", (error) =>
            Effect.succeed<CatalogProvider>({
              id: provider.id,
              displayName: provider.displayName,
              available: provider.available,
              brandPrefix: provider.strings?.brandPrefix ?? null,
              models: [],
              loadError: error.message,
            }),
          ),
        ),
      { concurrency: 4 },
    );
  });

  bb.rpc.register(rpcContract, {
    catalog: () => runtime.runPromise(catalog().pipe(Effect.map((providers) => ({ providers })))),
    hidden_get: () => runtime.runPromise(readHidden().pipe(Effect.map((hidden) => ({ hidden })))),
    hidden_set: ({ hidden }) =>
      runtime.runPromise(
        writeHidden(hidden).pipe(
          Semaphore.withPermit(mutationLock),
          Effect.map((hidden) => ({ hidden })),
        ),
      ),
  });

  // Same-origin read for the content script (it has no React hooks).
  bb.http.route("GET", "/hidden", (context) =>
    runtime.runPromise(readHidden().pipe(Effect.map((hidden) => context.json({ hidden })))),
  );

  const usage = [
    "Usage:",
    "  bb hide-models list [--json]",
    "  bb hide-models hide <provider-id> <model-id> [--json]",
    "  bb hide-models show <provider-id> <model-id> [--json]",
    "  bb hide-models clear [--json]",
  ].join("\n");
  const formatEntry = (entry: HiddenModel) =>
    `${entry.providerId}  ${entry.model}  (${entry.displayName})`;

  const cli = Effect.fn("HiddenModels.cli")(function* (argv: string[]) {
    const json = argv.includes("--json");
    const [command, providerId, model] = argv.filter((arg) => arg !== "--json");
    const reply = (value: unknown, text: string) => ({
      exitCode: 0,
      stdout: json ? JSON.stringify(value) : text,
    });
    switch (command) {
      case undefined:
      case "help":
      case "--help":
        return { exitCode: 0, stdout: usage };
      case "list": {
        const hidden = yield* readHidden();
        return reply(
          hidden,
          hidden.length === 0 ? "No hidden models." : hidden.map(formatEntry).join("\n"),
        );
      }
      case "hide": {
        if (providerId === undefined || model === undefined) break;
        const loaded = yield* catalog();
        const provider = loaded.find((entry) => entry.id === providerId);
        if (provider === undefined) {
          return { exitCode: 1, stderr: `Unknown provider "${providerId}".` };
        }
        const found = provider.models.find((entry) => entry.model === model);
        if (found === undefined) {
          return {
            exitCode: 1,
            stderr: `Provider "${providerId}" lists no model "${model}".`,
          };
        }
        const entry = { providerId, model, displayName: found.displayName };
        yield* writeHidden([...(yield* readHidden()), entry]);
        return reply(entry, `Hidden ${formatEntry(entry)}`);
      }
      case "show": {
        if (providerId === undefined || model === undefined) break;
        const hidden = yield* readHidden();
        const remaining = hidden.filter(
          (entry) => !(entry.providerId === providerId && entry.model === model),
        );
        if (remaining.length === hidden.length) {
          return { exitCode: 1, stderr: `"${providerId} ${model}" is not hidden.` };
        }
        yield* writeHidden(remaining);
        return reply({ providerId, model }, `Unhidden ${providerId} ${model}`);
      }
      case "clear": {
        yield* writeHidden([]);
        return reply({ hidden: [] }, "Cleared hidden models.");
      }
    }
    return { exitCode: 1, stderr: usage };
  });

  bb.cli.register({
    name: "hide-models",
    summary: "Hide models from bb's model picker (UI-only filter)",
    commands: [
      { name: "list", summary: "List hidden models", usage: "bb hide-models list [--json]" },
      {
        name: "hide",
        summary: "Hide a model",
        usage: "bb hide-models hide <provider-id> <model-id> [--json]",
      },
      {
        name: "show",
        summary: "Unhide a model",
        usage: "bb hide-models show <provider-id> <model-id> [--json]",
      },
      { name: "clear", summary: "Unhide every model", usage: "bb hide-models clear [--json]" },
    ],
    run: (argv) => runtime.runPromise(cli(argv).pipe(Semaphore.withPermit(mutationLock))),
  });

  bb.onDispose(() => Effect.runPromise(sync("log.disposed", () => bb.log.info("disposed"))));
}
