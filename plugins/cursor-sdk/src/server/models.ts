import type { ModelSelection, SDKModel } from "@cursor/sdk";
import {
  reasoningLevelSchema,
  type AvailableModel,
  type ReasoningLevel,
  type ServiceTier,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { SdkError } from "./operations.js";

const selectionSchema = z.object({
  id: z.string().min(1),
  params: z.array(z.object({ id: z.string(), value: z.string() })).optional(),
});
const prefix = "cursor-sdk:";
const effortIds = new Set(["effort", "reasoning", "reasoning_effort", "reasoningEffort"]);
const controlIds = new Set([...effortIds, "thinking", "fast"]);
const reasoningOrder: ReasoningLevel[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
];
type Variant = NonNullable<SDKModel["variants"]>[number];

export function encodeModel(selection: ModelSelection): string {
  return prefix + Buffer.from(JSON.stringify(selection)).toString("base64url");
}

// Accept the original preset IDs as well as IDs containing only fixed parameters.
export function decodeModel(value: string): ModelSelection {
  return value.startsWith(prefix)
    ? selectionSchema.parse(
        JSON.parse(Buffer.from(value.slice(prefix.length), "base64url").toString("utf8")),
      )
    : selectionSchema.parse({ id: value });
}

function fixedParams(selection: ModelSelection) {
  return (selection.params ?? [])
    .filter((p) => !controlIds.has(p.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function parameter(variant: Variant, id: string) {
  return variant.params.find((p) => p.id === id)?.value;
}

function reasoning(variant: Variant): ReasoningLevel | undefined {
  if (parameter(variant, "thinking") === "false") return "none";
  const effort = variant.params.find((p) => effortIds.has(p.id));
  if (effort) {
    const parsed = reasoningLevelSchema.safeParse(effort.value);
    return parsed.success ? parsed.data : undefined;
  }
  return parameter(variant, "thinking") === "true" ? "high" : "none";
}

function variants(model: SDKModel): Variant[] {
  return model.variants?.length ? model.variants : [{ displayName: model.displayName, params: [] }];
}

function preferred(group: Variant[]): Variant {
  return (
    group.find((v) => v.isDefault) ??
    group.find((v) => parameter(v, "fast") !== "true" && reasoning(v) === "medium") ??
    group.find((v) => parameter(v, "fast") !== "true") ??
    group[0]
  );
}

/** Resolve to an advertised SDK variant. BB's controls never invent SDK values
 * (in particular, Claude's effort enum has no "none": disable thinking instead). */
export function resolveModel(
  value: string,
  models: SDKModel[],
  level?: ReasoningLevel,
  tier?: ServiceTier,
): ModelSelection {
  const selection = decodeModel(value);
  const model = models.find((m) => m.id === selection.id || m.aliases?.includes(selection.id));
  if (!model)
    throw new SdkError({
      message: `Cursor model ${selection.id} is unavailable. Select a model from the current catalog.`,
    });
  const fixed = fixedParams(selection);
  const group = variants(model).filter((v) => fixed.every((p) => parameter(v, p.id) === p.value));
  if (!group.length)
    throw new SdkError({
      message: `The selected ${model.displayName} configuration is no longer available.`,
    });
  const legacy = selection.params?.some((p) => controlIds.has(p.id))
    ? group.find((v) => (selection.params ?? []).every((p) => parameter(v, p.id) === p.value))
    : undefined;
  const fallback = legacy ?? preferred(group);
  const hasReasoning = group.some((v) =>
    v.params.some((p) => p.id === "thinking" || effortIds.has(p.id)),
  );
  const desired = hasReasoning ? (level ?? reasoning(fallback)) : "none";
  const matching = group.filter((v) => reasoning(v) === desired);
  if (!matching.length)
    throw new SdkError({
      message: `${model.displayName} does not support ${desired} reasoning with this configuration.`,
    });
  const fast = tier === undefined ? parameter(fallback, "fast") === "true" : tier === "fast";
  // BB's speed toggle is provider-wide. Like Cursor ACP, use the available
  // speed when this particular model does not offer both tiers.
  const speed = matching.filter((v) => (parameter(v, "fast") === "true") === fast);
  const chosen = preferred(speed.length ? speed : matching);
  return { id: model.id, params: chosen.params };
}

export function modelCatalog(models: SDKModel[]): AvailableModel[] {
  return models
    .flatMap((model) => {
      const groups = new Map<string, Variant[]>();
      for (const variant of variants(model)) {
        if (reasoning(variant) === undefined) continue;
        const group = JSON.stringify(fixedParams({ id: model.id, params: variant.params }));
        groups.set(group, [...(groups.get(group) ?? []), variant]);
      }
      return [...groups.values()].map((group) => {
        const selected = preferred(group);
        const fixed = fixedParams({ id: model.id, params: selected.params });
        const efforts = reasoningOrder.filter((level) => group.some((v) => reasoning(v) === level));
        const suffix = fixed
          .filter((p) => p.value !== "false")
          .map((param) => {
            const definition = model.parameters?.find((p) => p.id === param.id);
            if (param.value === "true")
              return definition?.displayName ?? param.id[0].toUpperCase() + param.id.slice(1);
            return (
              definition?.values.find((v) => v.value === param.value)?.displayName ??
              `${definition?.displayName ?? param.id} ${param.value}`
            );
          })
          .join(", ");
        const id = encodeModel({ id: model.id, params: fixed });
        return {
          id,
          model: id,
          displayName: `${model.displayName}${suffix ? ` (${suffix})` : ""}`,
          description: model.description ?? selected.description ?? "Cursor SDK",
          isDefault: false,
          defaultReasoningEffort: reasoning(selected) ?? "none",
          supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
            reasoningEffort,
            description: reasoningEffort === "none" ? "No additional reasoning" : reasoningEffort,
          })),
        } satisfies AvailableModel;
      });
    })
    .map((model, index) => ({ ...model, isDefault: index === 0 }));
}

/** Saved threads may still reference a full preset ID. Keep its label and
 * controls available without putting the old presets back in the model list. */
export function legacyModelCatalog(
  models: SDKModel[],
  catalog: AvailableModel[],
): AvailableModel[] {
  const rows = new Map(catalog.map((row) => [row.id, row]));
  return models.flatMap((model) =>
    variants(model).flatMap((variant) => {
      const id = encodeModel({ id: model.id, params: variant.params });
      const current = rows.get(
        encodeModel({
          id: model.id,
          params: fixedParams({ id: model.id, params: variant.params }),
        }),
      );
      return current && !rows.has(id) ? [{ ...current, id, model: id, isDefault: false }] : [];
    }),
  );
}
