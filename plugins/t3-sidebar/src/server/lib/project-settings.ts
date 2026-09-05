import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { Context, Effect, Layer, ManagedRuntime, RcMap, Semaphore } from "effect";
import { call, sync, createRuntime } from "./server-effects";
import { projectHostContract } from "../../shared/project-host-contract";

import { preferencesSchema, projectSettingsContract } from "../../shared/project-settings-contract";
const key = (id: string) => `project-settings:${id}`;
class SettingsLocks extends Context.Service<
  SettingsLocks,
  RcMap.RcMap<string, Semaphore.Semaphore>
>()("sidebar/SettingsLocks") {}
const settingsLocks = Layer.effect(
  SettingsLocks,
  RcMap.make({ lookup: (_id: string) => Semaphore.make(1) }),
);
export function createProjectSettingsHandlers(bb: BbPluginApi) {
  const runtime = ManagedRuntime.make(settingsLocks);
  bb.onDispose(() => runtime.dispose());
  const read = Effect.fn("ProjectSettings.read")(function* (id: string) {
    const raw = yield* call("settings.read", () => bb.storage.kv.get(key(id)));
    return yield* sync("settings.decode", () => preferencesSchema.parse(raw ?? {}));
  });
  const get = Effect.fn("ProjectSettings.get")(function* ({ projectId }: { projectId: string }) {
    const project = yield* call("projects.get", () => bb.sdk.projects.get({ projectId }));
    if (project.kind === "personal")
      return yield* sync("project settings", () => {
        throw new Error("Personal workspace has no project settings");
      });
    const source = project.sources.find((s) => s.isDefault) ?? project.sources[0];
    const prefs = yield* read(projectId);
    let resolvedModel =
      prefs.model ??
      (yield* call("projects.defaultExecutionOptions", () =>
        bb.sdk.projects.defaultExecutionOptions({ projectId }),
      ).pipe(Effect.catchTag("BackendError", () => Effect.succeed(null))));
    if (!resolvedModel) {
      const catalog = yield* call("providers.models", () =>
        bb.sdk.providers.models(source ? { hostId: source.hostId } : {}),
      ).pipe(Effect.catchTag("BackendError", () => Effect.succeed(null)));
      const model = catalog?.models.find((m) => m.isDefault) ?? catalog?.models[0];
      const provider = model?.routeProviderId ?? catalog?.providers.find((p) => p.available)?.id;
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
  });
  const update = Effect.fn("ProjectSettings.update")(function* (
    input: z.infer<typeof projectSettingsContract.project_settings_update.input>,
  ) {
    const locks = yield* SettingsLocks;
    const lock = yield* RcMap.get(locks, input.projectId);
    return yield* Effect.gen(function* () {
      yield* get({ projectId: input.projectId });
      const { projectId, name, ...patch } = input;
      if (name !== undefined)
        yield* call("projects.update", () => bb.sdk.projects.update({ projectId, name }));
      const current = yield* read(projectId);
      yield* call("settings.write", () =>
        bb.storage.kv.set(key(projectId), { ...current, ...patch }),
      );
      yield* sync("settings.publish", () =>
        bb.realtime.publish("project-settings-changed", { projectId }),
      );
      return yield* get({ projectId });
    }).pipe(Semaphore.withPermit(lock));
  });
  return {
    project_settings_get: (input: { projectId: string }) => runtime.runPromise(get(input)),
    project_settings_update: (
      input: z.infer<typeof projectSettingsContract.project_settings_update.input>,
    ) => runtime.runPromise(update(input).pipe(Effect.scoped)),
  };
}
export function registerProjectAutoPull(bb: BbPluginApi) {
  const runtime = createRuntime(bb);
  const host = bb.hosts.experimental_client({ contract: projectHostContract });
  const passLock = Semaphore.makeUnsafe(1);
  const pass = Effect.fn("ProjectAutoPull.pass")(function* () {
    const hosts = yield* call("hosts.list", () => bb.sdk.hosts.list());
    const connected = new Set(
      hosts.filter((host) => host.status === "connected").map((host) => host.id),
    );
    const projects = yield* call("projects.list", () => bb.sdk.projects.list());
    for (const project of projects) {
      const stored = yield* call("settings.read", () => bb.storage.kv.get(key(project.id)));
      const prefs = preferencesSchema.safeParse(stored ?? {});
      if (!prefs.success || !prefs.data.autoPull) continue;
      for (const source of project.sources) {
        if (!connected.has(source.hostId)) continue;
        yield* call("host.pull", (signal) =>
          host.call("pull", { path: source.path }, { hostId: source.hostId, signal }),
        ).pipe(
          Effect.catchTag("BackendError", (error) =>
            Effect.sync(() => bb.log.warn(`Auto-pull ${project.name}: ${error.message}`)),
          ),
        );
      }
    }
  });
  // BB owns the cron lifecycle. Skip an overlapping tick; never overlap Git writes.
  bb.background.schedule("project-auto-pull", "*/5 * * * *", () =>
    runtime.runPromise(pass().pipe(passLock.withPermitsIfAvailable(1), Effect.asVoid)),
  );
}
