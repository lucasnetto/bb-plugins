import { expect, it } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/server";

function setup(failLink = false) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "multirepo",
    settings: { project: "p1" },
    sdk: {
      projects: {
        get: async () => ({
          id: "p1",
          name: "Workspace",
          sources: [{ type: "local_path", isDefault: true, path: "/workspace", hostId: "h1" }],
        }),
      },
      threads: {
        spawn: async () => ({ id: "review-thread" }),
        get: async () => ({ environmentId: "e1" }),
      },
      environments: {
        get: async () => {
          if (failLink) throw new Error("offline");
          return { path: "/workspace", hostId: "h1" };
        },
      },
    },
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      expect(method).toBe("linkedSummary");
      expect(hostId).toBe("h1");
      expect(input).toEqual({ root: "/workspace", url: "https://github.com/org/external/pull/42" });
      return {
        url: "https://github.com/org/external/pull/42",
        repository: "org/external",
        number: 42,
        title: "Fix",
        state: "OPEN",
        isDraft: true,
      };
    },
  });
  plugin(bb);
  return harness;
}
it("opens a URL review and links it even when the repository is not checked out", async () => {
  const harness = setup();
  try {
    expect(
      await harness.behavior.callRpc("reviewUrl", {
        url: "https://github.com/org/external/pull/42",
      }),
    ).toEqual({ threadId: "review-thread", warning: null });
    const links = await harness.behavior.callRpc("linkedList", { threadId: "review-thread" });
    expect(links).toMatchObject([{ repository: "org/external", reason: "requested-review" }]);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(JSON.stringify(harness.inspection.sdk.callsTo("threads.spawn"))).toContain(
      "gh pr diff 42 -R org/external",
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
it("returns the created thread with a recoverable warning if linking fails", async () => {
  const harness = setup(true);
  try {
    const result = await harness.behavior.callRpc("reviewUrl", {
      url: "https://github.com/org/external/pull/42",
    });
    expect(result).toMatchObject({
      threadId: "review-thread",
      warning: expect.stringContaining("offline"),
    });
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  } finally {
    await harness.lifecycle.dispose();
  }
});
it("rejects malformed URLs before spawning", async () => {
  const harness = setup();
  try {
    await expect(
      harness.behavior.callRpc("reviewUrl", { url: "https://evil.test/org/api/pull/42" }),
    ).rejects.toThrow();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  } finally {
    await harness.lifecycle.dispose();
  }
});
