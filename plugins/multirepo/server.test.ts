import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
test("review launch uses the umbrella host/path and exact repository/PR context", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "multirepo",
    settings: { project: "p1" },
    sdk: {
      projects: {
        get: async () => ({
          id: "p1",
          name: "Workspace",
          sources: [
            {
              type: "local_path",
              isDefault: true,
              path: "/workspace",
              hostId: "h1",
            },
          ],
        }),
      },
      threads: { spawn: async () => ({ id: "review-thread" }) },
    },
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      assert.equal(method, "reviewTarget");
      assert.equal(hostId, "h1");
      assert.deepEqual(input, { root: "/workspace", repo: "api", number: 42 });
      return {
        path: "/workspace/api",
        remote: "org/api",
        pr: {
          number: 42,
          title: "Fix",
          url: "https://github.com/org/api/pull/42",
          headRefName: "fix",
          baseRefName: "main",
          isDraft: false,
          author: "user",
        },
      };
    },
  });
  try {
    plugin(bb);
    const result = await harness.behavior.callRpc("review", {
      repo: "api",
      number: 42,
    });
    assert.ok(JSON.stringify(result).includes("review-thread"));
    const calls = harness.inspection.sdk.callsTo("threads.spawn");
    assert.equal(calls.length, 1);
    const serialized = JSON.stringify(calls[0]);
    assert.match(serialized, /workspace\/api/);
    assert.match(serialized, /gh pr diff 42 -R org\/api/);
    assert.match(serialized, /unmanaged/);
    assert.match(serialized, /do not switch the shared checkout/);
  } finally {
    await harness.lifecycle.dispose();
  }
});
