import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Schema } from "effect";
import { call, fail, decodeSchema } from "./server-effects";
import { guideModelSchema, type GuideModel } from "../shared/guide-generation";

/** Resolve project, plugin, thread, and catalog defaults in that order. */
export function createGuideModels(bb: BbPluginApi) {
  const modelSettingsKey = (projectId: string | null) => `guide-model:${projectId ?? "default"}`;

  const readModel = Effect.fn("Guide.model")(function* (projectId: string | null) {
    return yield* decodeSchema(
      "guide model",
      Schema.NullOr(guideModelSchema),
    )(
      (yield* call("guide defaults", () => bb.storage.kv.get(modelSettingsKey(projectId)))) ?? null,
    );
  });

  const guideDefaultsSave = Effect.fn("Guide.defaultsSave")(function* (input: {
    projectId: string | null;
    model: GuideModel | null;
  }) {
    yield* call("guide defaults save", () =>
      bb.storage.kv.set(modelSettingsKey(input.projectId), input.model),
    );

    return null;
  });

  const guideSettings = Effect.fn("Guide.settings")(function* ({
    projectId,
  }: {
    projectId: string | null;
  }) {
    const projects = yield* call("projects.list", () => bb.sdk.projects.list());
    const model = yield* readModel(projectId);
    let fallback = projectId ? yield* readModel(null) : null;

    if (!model && !fallback) {
      const catalog = yield* call("guide model catalog", () => bb.sdk.providers.models({}));
      const selected = catalog.models.find((m) => m.isDefault) ?? catalog.models[0];

      const providerId =
        selected?.routeProviderId ?? catalog.providers.find((p) => p.available)?.id;

      if (selected && providerId)
        fallback = {
          providerId,
          model: selected.model,
          reasoningLevel: selected.defaultReasoningEffort,
        };
    }

    return { model, fallback, projects: projects.map(({ id, name }) => ({ id, name })) };
  });

  const guideOptions = Effect.fn("Guide.options")(function* ({ threadId }: { threadId: string }) {
    const thread = yield* call("threads.get", () => bb.sdk.threads.get({ threadId }));
    const environmentId = thread.environmentId;

    if (!environmentId) return yield* fail("This thread needs a workspace to generate a guide.");
    const projectModel = yield* readModel(thread.projectId);
    const pluginModel = yield* readModel(null);

    const threadDefaults =
      !projectModel && !pluginModel
        ? yield* call("thread model", () => bb.sdk.threads.defaultExecutionOptions({ threadId }))
        : null;

    let model = yield* decodeSchema(
      "guide model",
      Schema.NullOr(guideModelSchema),
    )(
      projectModel ??
        pluginModel ??
        (threadDefaults ? { ...threadDefaults, providerId: thread.providerId } : null),
    );

    if (!model) {
      const catalog = yield* call("guide model catalog", () =>
        bb.sdk.providers.models({
          environmentId,
          providerId: thread.providerId,
        }),
      );

      const selected = catalog.models.find((m) => m.isDefault) ?? catalog.models[0];

      if (!selected)
        return yield* fail(
          "No model is available for this thread. Configure a guide model in PR Review settings.",
        );
      model = {
        providerId: selected.routeProviderId ?? thread.providerId,
        model: selected.model,
        reasoningLevel: selected.defaultReasoningEffort,
      };
    }

    return {
      projectId: thread.projectId,
      environmentId,
      model,
      source: projectModel
        ? ("project" as const)
        : pluginModel
          ? ("plugin" as const)
          : ("thread" as const),
    };
  });

  return { guideOptions, guideSettings, guideDefaultsSave };
}
