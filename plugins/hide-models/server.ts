// bb-plugin-hide-models — backend.
//
// Stores a per-provider denylist of models. Model discovery is untouched: the
// frontend content script hides matching rows in bb's model picker, so this is
// a UI-only filter (t3code-style "hide models from a provider").
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const hiddenModelSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  // Picker label at the time of hiding; the content script matches rows by
  // display name because bb's picker exposes no model-id DOM attribute.
  displayName: z.string().min(1),
});
export type HiddenModel = z.infer<typeof hiddenModelSchema>;

const catalogModelSchema = z.object({
  model: z.string(),
  displayName: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
});
const catalogProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  available: z.boolean(),
  brandPrefix: z.string().nullable(),
  models: z.array(catalogModelSchema),
  loadError: z.string().nullable(),
});
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;

export const rpcContract = defineRpcContract({
  catalog: {
    input: z.null(),
    output: z.object({ providers: z.array(catalogProviderSchema) }),
  },
  hidden_get: {
    input: z.null(),
    output: z.object({ hidden: z.array(hiddenModelSchema) }),
  },
  hidden_set: {
    input: z.object({ hidden: z.array(hiddenModelSchema).max(500) }),
    output: z.object({ hidden: z.array(hiddenModelSchema) }),
  },
});

export const HIDDEN_CHANGED = "hidden-changed";
const KV_KEY = "hidden";

const keyOf = (entry: HiddenModel) => `${entry.providerId}\u0000${entry.model}`;

const dedupe = (entries: HiddenModel[]): HiddenModel[] => [
  ...new Map(entries.map((entry) => [keyOf(entry), entry])).values(),
];

export default async function plugin(bb: BbPluginApi) {
  const readHidden = async (): Promise<HiddenModel[]> =>
    (await bb.storage.kv.get<HiddenModel[]>(KV_KEY)) ?? [];

  const writeHidden = async (entries: HiddenModel[]): Promise<HiddenModel[]> => {
    const hidden = dedupe(entries);
    await bb.storage.kv.set(KV_KEY, hidden);
    bb.realtime.publish(HIDDEN_CHANGED, { count: hidden.length });
    return hidden;
  };

  const loadCatalog = async (): Promise<CatalogProvider[]> => {
    const providers = await bb.sdk.providers.list();
    return Promise.all(
      providers.map(async (provider) => {
        const result = await bb.sdk.providers
          .models({ providerId: provider.id })
          .catch((cause: unknown) => ({
            models: [],
            modelLoadError: {
              code: cause instanceof Error ? cause.message : String(cause),
              providerId: provider.id,
            },
          }));
        return {
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
        };
      }),
    );
  };

  bb.rpc.register(rpcContract, {
    catalog: async () => ({ providers: await loadCatalog() }),
    hidden_get: async () => ({ hidden: await readHidden() }),
    hidden_set: async ({ hidden }) => ({ hidden: await writeHidden(hidden) }),
  });

  // Same-origin read for the content script (it has no React hooks).
  bb.http.route("GET", "/hidden", async (context) => context.json({ hidden: await readHidden() }));

  const usage = [
    "Usage:",
    "  bb hide-models list [--json]",
    "  bb hide-models hide <provider-id> <model-id> [--json]",
    "  bb hide-models show <provider-id> <model-id> [--json]",
    "  bb hide-models clear [--json]",
  ].join("\n");
  const formatEntry = (entry: HiddenModel) =>
    `${entry.providerId}  ${entry.model}  (${entry.displayName})`;

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
    async run(argv) {
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
          const hidden = await readHidden();
          return reply(
            hidden,
            hidden.length === 0 ? "No hidden models." : hidden.map(formatEntry).join("\n"),
          );
        }
        case "hide": {
          if (providerId === undefined || model === undefined) break;
          const catalog = await loadCatalog();
          const provider = catalog.find((entry) => entry.id === providerId);
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
          await writeHidden([...(await readHidden()), entry]);
          return reply(entry, `Hidden ${formatEntry(entry)}`);
        }
        case "show": {
          if (providerId === undefined || model === undefined) break;
          const hidden = await readHidden();
          const remaining = hidden.filter(
            (entry) => !(entry.providerId === providerId && entry.model === model),
          );
          if (remaining.length === hidden.length) {
            return { exitCode: 1, stderr: `"${providerId} ${model}" is not hidden.` };
          }
          await writeHidden(remaining);
          return reply({ providerId, model }, `Unhidden ${providerId} ${model}`);
        }
        case "clear": {
          await writeHidden([]);
          return reply({ hidden: [] }, "Cleared hidden models.");
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
