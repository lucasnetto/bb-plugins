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
      interfaceFontSize: "20px",
      codeFontSize: "14px",
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
    for (const size of ["0px", "999px", "14px; color: red", 14, "125%"]) {
      await expect(harness.behavior.setSettings({ interfaceFontSize: size })).rejects.toThrow();
      await expect(harness.behavior.setSettings({ codeFontSize: size })).rejects.toThrow();
    }
    await expect(harness.behavior.setSettings({ codeFontSize: "17px" })).rejects.toThrow();
    await harness.behavior.setSettings({
      interfaceFont: "BB default",
      codeFont: "BB default",
      interfaceFontSize: "BB default",
      codeFontSize: "BB default",
    });
  } finally {
    await harness.lifecycle.dispose();
  }
});
