import { expect, it } from "vite-plus/test";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import { fileURLToPath } from "node:url";
import plugin from "../server";

it("routes listing to the primary machine without a local workspace", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "pr-review",
    sdk: {
      system: { config: async () => ({ primaryHostId: "remote" }) },
    },
    experimental_callHostRpc: async ({ hostId, method, input }) => {
      expect(hostId).toBe("remote");
      expect(method).toBe("list");
      expect(input).toEqual({ view: "reviewing", page: 2 });
      return { viewer: "lucas", rows: [], total: 0, nextPage: null, incomplete: false };
    },
  });
  try {
    await plugin(bb);
    await harness.behavior.callRpc("list", { view: "reviewing", page: 2 });
    expect(harness.inspection.sdk.callsTo("plugins.callRpc")).toHaveLength(0);
  } finally {
    await harness.lifecycle.dispose();
  }
});
it("uses only public SDK imports", () => {
  const result = experimental_scanPublicSdkOnly(fileURLToPath(new URL("..", import.meta.url)), {
    allow: [
      /^react(?:-dom)?$/,
      /^effect$/,
      /^better-sqlite3$/,
      /^@pierre\//,
      /^@hugeicons\//,
      /^sonner$/,
      /^class-variance-authority$/,
      /^@radix-ui\//,
      /^clsx$/,
      /^tailwind-merge$/,
      /^vite-plus(?:\/test)?$/,
      /^@testing-library\/react$/,
    ],
  });
  expect(result.violations).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});

it("exposes PR commands and removes repository browsing APIs", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "pr-review" });
  try {
    await plugin(bb);
    const help = await harness.behavior.runCli(["--help"]);
    expect(help.stdout).toContain("bb pr-review links");
    expect(help.stdout).not.toMatch(/multirepo|status|changes|files|diff/);
    expect((await harness.behavior.runCli(["status"])).exitCode).toBe(1);
    for (const method of ["workspace", "discover", "changes", "files", "detail"])
      await expect(harness.behavior.callRpc(method, null)).rejects.toThrow();
  } finally {
    await harness.lifecycle.dispose();
  }
});
