import { expect, it } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { registerLocalChanges } from "../../src/local-changes/server";

it("routes reads to the thread environment's host and worktree", async () => {
  const harness = createFakePluginHost({
    sdk: {
      threads: { get: () => makeThreadResponse({ environmentId: "env" }) },
      environments: { get: async () => ({ path: "/outside/worktree", hostId: "remote" }) },
    },
    experimental_callHostRpc: ({ input, hostId }) => {
      expect(hostId).toBe("remote");
      expect(input).toEqual({ root: "/outside/worktree" });

      return { root: "/outside/worktree", checkouts: [], warnings: [] };
    },
  });

  registerLocalChanges(harness.bb);
  await harness.harness.behavior.callRpc("localSnapshot", { threadId: "thread" });
  await harness.harness.lifecycle.dispose();
});

it("falls back to the project's default directory when there is no environment", async () => {
  const harness = createFakePluginHost({
    sdk: {
      threads: { get: () => makeThreadResponse({ environmentId: null, projectId: "project" }) },
      projects: {
        get: async () => ({
          sources: [
            {
              id: "source",
              projectId: "project",
              path: "/180seg",
              hostId: "default-host",
              type: "local_path",
              isDefault: true,
              createdAt: 0,
              updatedAt: 0,
            },
          ],
        }),
      },
    },
    experimental_callHostRpc: ({ input, hostId }) => {
      expect(hostId).toBe("default-host");
      expect(input).toEqual({ root: "/180seg" });

      return { root: "/180seg", checkouts: [], warnings: [] };
    },
  });

  registerLocalChanges(harness.bb);
  await harness.harness.behavior.callRpc("localSnapshot", { threadId: "thread" });
  await harness.harness.lifecycle.dispose();
});
