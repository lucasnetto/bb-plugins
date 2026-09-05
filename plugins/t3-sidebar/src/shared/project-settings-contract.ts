import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const projectModelSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningLevel: z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]),
  serviceTier: z.enum(["default", "fast"]).optional(),
});
export const preferencesSchema = z.object({
  model: projectModelSchema.nullable().default(null),
  workspace: z.enum(["default", "worktree", "local"]).default("default"),
  autoPull: z.boolean().default(false),
});
export const projectSettingsSchema = preferencesSchema.extend({
  id: z.string(),
  name: z.string(),
  hostId: z.string().nullable(),
  path: z.string().nullable(),
  resolvedModel: projectModelSchema.nullable(),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export const projectSettingsContract = defineRpcContract({
  project_settings_get: {
    input: z.object({ projectId: z.string().min(1) }),
    output: projectSettingsSchema,
  },
  project_settings_update: {
    input: z
      .object({
        projectId: z.string().min(1),
        name: z.string().trim().min(1).optional(),
        model: projectModelSchema.nullable().optional(),
        workspace: z.enum(["default", "worktree", "local"]).optional(),
        autoPull: z.boolean().optional(),
      })
      .strict(),
    output: projectSettingsSchema,
  },
});
