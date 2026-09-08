import { expect, it } from "vite-plus/test";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import { fileURLToPath } from "node:url";
import plugin from "../server";

it("routes listing to the primary machine independently of Multirepo and reviews through Multirepo", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "pr-review",
    sdk: {
      system: { config: async () => ({ primaryHostId: "remote" }) },
      plugins: {
        callRpc: async ({ method }: { method: string }) => {
          if (method !== "reviewUrl") throw new Error("Project not found");
          return { threadId: "t1", warning: null };
        },
      },
    },
    experimental_callHostRpc: async ({ hostId, method, input }) => {
      expect(hostId).toBe("remote");
      expect(method).toBe("list");
      expect(input).toEqual({ view: "reviewing", page: 2 });
      return { viewer: "lucas", rows: [], total: 0, nextPage: null, incomplete: false };
    },
  });
  try {
    plugin(bb);
    await harness.behavior.callRpc("list", { view: "reviewing", page: 2 });
    expect(harness.inspection.sdk.callsTo("plugins.callRpc")).toHaveLength(0);
    expect(
      await harness.behavior.callRpc("review", { url: "https://github.com/acme/api/pull/42" }),
    ).toEqual({ threadId: "t1", warning: null });
    const calls = harness.inspection.sdk.callsTo("plugins.callRpc");
    expect(JSON.stringify(calls)).toContain('"pluginId":"multirepo"');
    expect(JSON.stringify(calls)).toContain('"method":"reviewUrl"');
    await expect(
      harness.behavior.callRpc("review", { url: "https://evil.test/pull/42" }),
    ).rejects.toThrow();
    expect(harness.inspection.sdk.callsTo("plugins.callRpc")).toHaveLength(1);
  } finally {
    await harness.lifecycle.dispose();
  }
});
it("uses only public SDK imports", () => {
  const result = experimental_scanPublicSdkOnly(fileURLToPath(new URL("..", import.meta.url)), {
    allow: [
      /^react$/,
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
