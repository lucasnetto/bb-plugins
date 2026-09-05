import { Schema } from "effect";
import { guideTarget } from "./guide-contract";

export const guideModelSchema = Schema.Struct({
  providerId: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoningLevel: Schema.Literals([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
    "ultracode",
  ]),
  serviceTier: Schema.optionalKey(Schema.Literals(["default", "fast"])),
});
export type GuideModel = Schema.Schema.Type<typeof guideModelSchema>;
export const guideJobSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  url: Schema.String,
  workerId: Schema.NullOr(Schema.String),
  status: Schema.Literals(["preparing", "running", "complete", "error", "cancelled"]),
  error: Schema.String,
  base: Schema.String,
  head: Schema.String,
});
export type GuideJob = Schema.Schema.Type<typeof guideJobSchema>;
export const guideStartInput = guideTarget.pipe(Schema.fieldsAssign({ model: guideModelSchema }));
export const guideDefaultsInput = Schema.Struct({ projectId: Schema.NullOr(Schema.String) });
export const guideDefaultsSaveInput = guideDefaultsInput.pipe(
  Schema.fieldsAssign({
    model: Schema.NullOr(guideModelSchema),
  }),
);
export const guideOptionsSchema = Schema.Struct({
  projectId: Schema.String,
  environmentId: Schema.String,
  model: Schema.NullOr(guideModelSchema),
  source: Schema.Literals(["project", "plugin", "thread"]),
});
export const guideSettingsSchema = Schema.Struct({
  model: Schema.NullOr(guideModelSchema),
  fallback: Schema.NullOr(guideModelSchema),
  projects: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
