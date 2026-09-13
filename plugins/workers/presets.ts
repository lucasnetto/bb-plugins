import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const reasoningLevelSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
]);

export const presetSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/)
      .refine((name) => name !== "inherit", "inherit is reserved; omit preset to inherit"),
    description: z.string().trim().min(1).max(300),
    providerId: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(300),
    reasoningLevel: reasoningLevelSchema,
  })
  .strict();

export const presetsSchema = z
  .array(presetSchema)
  .max(20)
  .refine(
    (presets) => new Set(presets.map((preset) => preset.name)).size === presets.length,
    "Preset names must be unique",
  );

export const configurationSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    presets: presetsSchema,
  })
  .strict();

export type WorkerPreset = z.infer<typeof presetSchema>;

export const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(100_000),
});

export const toolSchema = taskSchema
  .extend({ preset: z.string().min(1).max(64).optional() })
  .strict();

export function advertisedParameters(presets: WorkerPreset[]) {
  if (!presets.length) return z.toJSONSchema(taskSchema.strict());

  return z.toJSONSchema(
    taskSchema
      .extend({
        preset: z
          .enum(presets.map((preset) => preset.name))
          .optional()
          .describe(
            "Omit to inherit the parent configuration. Configured presets (name: description):\n" +
              presets
                .map(
                  ({ name, description }) =>
                    `${JSON.stringify(name)}: ${JSON.stringify(description)}`,
                )
                .join("\n"),
          ),
      })
      .strict(),
  );
}

// Use the same live catalog as BB's picker, but reject rather than reconcile a
// stale selection. For spawning, discovery must run in the parent's environment.
export async function validatePreset(
  bb: BbPluginApi,
  preset: WorkerPreset,
  environmentId?: string,
) {
  const routing = environmentId ? { environmentId } : {};
  const providers = await bb.sdk.providers.list(routing);

  if (!providers.some((provider) => provider.id === preset.providerId && provider.available)) {
    throw new Error(
      `Preset "${preset.name}": provider "${preset.providerId}" is unavailable in this BB profile or execution environment. Edit it in Workers settings.`,
    );
  }

  const catalog = await bb.sdk.providers.models({ ...routing, providerId: preset.providerId });

  if (catalog.modelLoadError) {
    throw new Error(
      `Preset "${preset.name}": model discovery failed (${catalog.modelLoadError.code}). Check the provider connection.`,
    );
  }

  const model = catalog.models.find((model) => model.model === preset.model);

  if (!model)
    throw new Error(
      `Preset "${preset.name}": model "${preset.model}" is unavailable. Edit it in Workers settings.`,
    );
  const supported = model.supportedReasoningEfforts;

  if (
    !(supported.length
      ? supported.some((level) => level.reasoningEffort === preset.reasoningLevel)
      : preset.reasoningLevel === model.defaultReasoningEffort)
  ) {
    throw new Error(
      `Preset "${preset.name}": thinking level "${preset.reasoningLevel}" is unsupported for "${preset.model}". Edit it in Workers settings.`,
    );
  }
}
