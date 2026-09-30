import { afterEach, expect, test } from "vite-plus/test";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "../server";
import { configurationSchema } from "../presets";

const preset = {
  name: "quick-task",
  description: "Small, well-defined changes.",
  providerId: "pi",
  model: "test/model",
  reasoningLevel: "low" as const,
};

const provider: Awaited<ReturnType<BbPluginApi["sdk"]["providers"]["list"]>>[number] = {
  id: "pi",
  pluginId: "provider-pi",
  displayName: "Pi",
  available: true,
  completedTurnDisplay: "collapse",
  logoUrl: null,
  maintenance: { health: false, usage: false, installation: false },
  composerActions: [],
  capabilities: {
    supportsThreadArchive: true,
    supportsThreadRename: true,
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    permissionModes: ["accept-edits"],
    supportsFork: false,
    supportsSessionRewind: false,
    modelCatalogScope: "host",
  },
};

const catalog: Awaited<ReturnType<BbPluginApi["sdk"]["providers"]["models"]>> = {
  modelLoadError: null,
  permissionCeiling: "accept-edits",
  providers: [provider],
  selectedOnlyModels: [],
  models: [
    {
      id: "test/model",
      model: "test/model",
      displayName: "Test model",
      description: "",
      isDefault: true,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Low" }],
    },
  ],
};

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

async function setup() {
  const host = createFakePluginHost({
    pluginId: "workers",
    agentSkillIds: ["bb-workers", "fusion"],
    sdk: {
      providers: { list: async () => [provider], models: async () => catalog },
      threads: {
        get: async () =>
          makeThreadResponse({
            id: "parent",
            providerId: "codex",
            environmentId: "environment",
            projectId: "project",
          }),
        defaultExecutionOptions: async () => ({
          model: "parent-model",
          reasoningLevel: "high",
          permissionMode: "accept-edits",
        }),
        spawn: async () => makeThreadResponse({ id: "worker" }),
      },
    },
  });

  await plugin(host.bb);
  disposers.push(() => host.harness.lifecycle.dispose());

  return host.harness;
}

const task = { title: "Task", prompt: "Do the task" };

test("advertises inheritance only by default, then configured names and descriptions without raw execution options", async () => {
  const harness = await setup();
  const context = makePluginAgentConfigurationContext();
  const initial = await harness.behavior.resolveAgentConfiguration(context);
  const initialJson = JSON.stringify(initial);
  expect(initialJson).not.toContain('"preset"');
  expect(initialJson).not.toContain('"providerId"');
  expect(initialJson).toContain('"title"');
  await harness.behavior.callRpc("saveConfiguration", { revision: 0, presets: [preset] });
  const configured = JSON.stringify(await harness.behavior.resolveAgentConfiguration(context));
  expect(configured).toContain(preset.name);
  expect(configured).toContain(preset.description);
  expect(configured).not.toContain(preset.model);
  await harness.lifecycle.reload(plugin);
  expect(await harness.behavior.callRpc("getConfiguration", {})).toEqual({
    revision: 1,
    presets: [preset],
  });
});

test("resolves a preset and validates it in the immediate parent's environment", async () => {
  const harness = await setup();
  await harness.behavior.callRpc("saveConfiguration", { revision: 0, presets: [preset] });
  await harness.behavior.callAgentTool(
    "bb_worker_thread",
    { ...task, preset: preset.name },
    { threadId: "parent" },
  );
  expect(harness.inspection.sdk.callsTo("providers.models").at(-1)?.[0]).toEqual({
    providerId: "pi",
    environmentId: "environment",
  });
  expect(harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
    providerId: "pi",
    model: "test/model",
    reasoningLevel: "low",
    parentThreadId: "parent",
    visibility: "hidden",
    permissionMode: "accept-edits",
    pluginMetadata: {
      preset: "quick-task",
      providerId: "pi",
      model: "test/model",
      reasoningLevel: "low",
    },
  });
});

test("rejects unknown/removed presets and raw execution overrides", async () => {
  const harness = await setup();

  for (const input of [
    { preset: "missing" },
    { providerId: "pi" },
    { model: "test/model" },
    { reasoningLevel: "high" },
  ]) {
    await expect(
      harness.behavior.callAgentTool("bb_worker_thread", { ...task, ...input }),
    ).rejects.toThrow();
  }

  await harness.behavior.callRpc("saveConfiguration", { revision: 0, presets: [preset] });
  await harness.behavior.callRpc("saveConfiguration", { revision: 1, presets: [] });
  await expect(
    harness.behavior.callAgentTool("bb_worker_thread", { ...task, preset: preset.name }),
  ).rejects.toThrow("Unknown worker preset");
  expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
});

test("validates persisted shape, names, descriptions and unique preset identifiers", () => {
  for (const presets of [
    [preset, preset],
    [{ ...preset, name: "inherit" }],
    [{ ...preset, name: "Bad name" }],
    [{ ...preset, description: " " }],
    [{ ...preset, reasoningLevel: "invalid" }],
  ]) {
    expect(configurationSchema.safeParse({ revision: 0, presets }).success).toBe(false);
  }
});

test.each(["provider", "model", "thinking", "discovery"])(
  "rejects unavailable %s at save and spawn without fallback",
  async (failure) => {
    const harness = await setup();
    await harness.behavior.callRpc("saveConfiguration", { revision: 0, presets: [preset] });

    if (failure === "provider") harness.inspection.sdk.stub("providers.list", async () => []);

    if (failure === "model")
      harness.inspection.sdk.stub("providers.models", async () => ({ ...catalog, models: [] }));

    if (failure === "thinking")
      harness.inspection.sdk.stub("providers.models", async () => ({
        ...catalog,
        models: [
          {
            ...catalog.models[0]!,
            supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
          },
        ],
      }));

    if (failure === "discovery")
      harness.inspection.sdk.stub("providers.models", async () => ({
        ...catalog,
        modelLoadError: { code: "auth_required", providerId: "pi" },
      }));
    await expect(
      harness.behavior.callAgentTool("bb_worker_thread", { ...task, preset: preset.name }),
    ).rejects.toThrow();
    await expect(
      harness.behavior.callRpc("saveConfiguration", {
        revision: 1,
        presets: [{ ...preset, name: "another" }],
      }),
    ).rejects.toThrow();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
    // Removing a stale preset remains possible while discovery is broken.
    await harness.behavior.callRpc("saveConfiguration", { revision: 1, presets: [] });
  },
);

test("concurrent settings saves cannot silently overwrite another window", async () => {
  const harness = await setup();

  const results = await Promise.allSettled([
    harness.behavior.callRpc("saveConfiguration", { revision: 0, presets: [preset] }),
    harness.behavior.callRpc("saveConfiguration", { revision: 0, presets: [] }),
  ]);

  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(await harness.behavior.callRpc("getConfiguration", {})).toEqual({
    revision: 1,
    presets: [preset],
  });
});
