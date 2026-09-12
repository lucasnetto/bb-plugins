import { expect, test } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/server.js";

test("one provider derives its runtime from the Cloud agents toggle", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "cursor-sdk", dataDir: "/tmp/.bb" });
  try {
    plugin(bb);
    const providers = harness.inspection.registrations.providerRegistrations;
    expect(providers.map((provider) => provider.id)).toEqual(["cursor-sdk"]);
    const derive = providers[0].deriveProviderOptions;
    expect(derive).toBeTypeOf("function");
    const context = {
      threadId: "thread",
      projectId: "project",
      model: "model",
      permissionMode: "full" as const,
    };
    expect(derive?.({ ...context, settings: {} })).toEqual({ runtime: "local" });
    expect(derive?.({ ...context, settings: { cloudAgents: true } })).toEqual({ runtime: "cloud" });
    expect(derive?.({ ...context, settings: { cloudAgents: false } })).toEqual({
      runtime: "local",
    });
    await harness.behavior.setSettings({ cloudAgents: true });
  } finally {
    await harness.lifecycle.dispose();
  }
});
