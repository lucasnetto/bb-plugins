import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { projectHostContract } from "./project-host-contract";

export const projectModelSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningLevel: z.enum([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
    "ultracode",
  ]),
  serviceTier: z.enum(["default", "fast"]).optional(),
});
const preferencesSchema = z.object({
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
const key = (id: string) => `project-settings:${id}`;
export function createProjectSettingsHandlers(bb: BbPluginApi) {
  const read = async (id: string) =>
    preferencesSchema.parse((await bb.storage.kv.get(key(id))) ?? {});
  const get = async ({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectSettings> => {
    const project = await bb.sdk.projects.get({ projectId });
    if (project.kind === "personal")
      throw new Error("Personal workspace has no project settings");
    const source =
      project.sources.find((s) => s.isDefault) ?? project.sources[0];
    const prefs = await read(projectId);
    let resolvedModel =
      prefs.model ??
      (await bb.sdk.projects
        .defaultExecutionOptions({ projectId })
        .catch(() => null));
    if (!resolvedModel) {
      const catalog = await bb.sdk.providers
        .models(source ? { hostId: source.hostId } : {})
        .catch(() => null);
      const model =
        catalog?.models.find((m) => m.isDefault) ?? catalog?.models[0];
      const provider =
        model?.routeProviderId ??
        catalog?.providers.find((p) => p.available)?.id;
      if (model && provider)
        resolvedModel = {
          providerId: provider,
          model: model.model,
          reasoningLevel: model.defaultReasoningEffort,
        };
    }
    return {
      ...prefs,
      id: project.id,
      name: project.name,
      hostId: source?.hostId ?? null,
      path: source?.path ?? null,
      resolvedModel,
    };
  };
  const queues = new Map<string, Promise<unknown>>();
  return {
    project_settings_get: get,
    project_settings_update: (
      input: z.infer<
        typeof projectSettingsContract.project_settings_update.input
      >,
    ) => {
      const previous = queues.get(input.projectId) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(async () => {
          await get({ projectId: input.projectId });
          const { projectId, name, ...patch } = input;
          if (name !== undefined)
            await bb.sdk.projects.update({ projectId, name });
          await bb.storage.kv.set(key(projectId), {
            ...(await read(projectId)),
            ...patch,
          });
          bb.realtime.publish("project-settings-changed", { projectId });
          return get({ projectId });
        });
      queues.set(input.projectId, next);
      void next
        .finally(() => {
          if (queues.get(input.projectId) === next)
            queues.delete(input.projectId);
        })
        .catch(() => {});
      return next;
    },
  };
}
export function registerProjectAutoPull(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: projectHostContract });
  bb.background.schedule("project-auto-pull", "*/5 * * * *", async () => {
    const connected = new Set(
      (await bb.sdk.hosts.list())
        .filter((h) => h.status === "connected")
        .map((h) => h.id),
    );
    for (const project of await bb.sdk.projects.list()) {
      const prefs = preferencesSchema.safeParse(
        (await bb.storage.kv.get(key(project.id))) ?? {},
      );
      if (!prefs.success || !prefs.data.autoPull) continue;
      for (const source of project.sources) {
        if (!connected.has(source.hostId)) continue;
        try {
          await host.call(
            "pull",
            { path: source.path },
            { hostId: source.hostId },
          );
        } catch (error) {
          bb.log.warn(`Auto-pull ${project.name}: ${String(error)}`);
        }
      }
    }
  });
}
