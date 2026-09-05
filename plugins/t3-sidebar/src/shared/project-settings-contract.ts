import { standardSchema } from "./standard-schema";
import { Schema, Effect } from "effect";
import { defineRpcContract } from "@get-bb/plugin-sdk";

export const projectModelSchema = Schema.Struct({
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
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });
export const preferencesSchema = Schema.Struct({
  model: Schema.NullOr(projectModelSchema).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  workspace: Schema.Literals(["default", "worktree", "local"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("default")),
  ),
  autoPull: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export const projectSettingsSchema = preferencesSchema.pipe(
  Schema.fieldsAssign({
    id: Schema.String,
    name: Schema.String,
    hostId: Schema.NullOr(Schema.String),
    path: Schema.NullOr(Schema.String),
    resolvedModel: Schema.NullOr(projectModelSchema),
  }),
);
export type ProjectSettings = Schema.Schema.Type<typeof projectSettingsSchema>;
export const projectSettingsContract = defineRpcContract({
  project_settings_get: {
    input: standardSchema(Schema.Struct({ projectId: Schema.String.check(Schema.isMinLength(1)) })),
    output: standardSchema(projectSettingsSchema),
  },
  project_settings_update: {
    input: standardSchema(
      Schema.Struct({
        projectId: Schema.String.check(Schema.isMinLength(1)),
        name: Schema.optionalKey(Schema.Trim.check(Schema.isMinLength(1))),
        model: Schema.optionalKey(Schema.NullOr(projectModelSchema)),
        workspace: Schema.optionalKey(Schema.Literals(["default", "worktree", "local"])),
        autoPull: Schema.optionalKey(Schema.Boolean),
      }).annotate({ parseOptions: { onExcessProperty: "error" } }),
    ),
    output: standardSchema(projectSettingsSchema),
  },
});
