// @vitest-environment node
import { expect, it } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/server";

it("accepts installed font names and rejects CSS and unsupported presets", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "bb-fonts" });

  try {
    plugin(bb);
    await harness.behavior.setSettings({
      interfaceFont: "Custom",
      customInterfaceFont: "Avenir Next",
      codeFont: "Menlo",
    });
    await expect(
      harness.behavior.setSettings({ customInterfaceFont: 'x"; } body { display: none }' }),
    ).rejects.toThrow();
    await expect(
      harness.behavior.setSettings({ customCodeFont: "x".repeat(101) }),
    ).rejects.toThrow();
    await expect(
      harness.behavior.setSettings({ interfaceFont: "Unknown preset" }),
    ).rejects.toThrow();
    await harness.behavior.setSettings({ interfaceFont: "BB default", codeFont: "BB default" });
  } finally {
    await harness.lifecycle.dispose();
  }
});
