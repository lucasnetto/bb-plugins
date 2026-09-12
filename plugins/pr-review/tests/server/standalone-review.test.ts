import { expect, it } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";

const url = "https://github.com/org/external/pull/42";
async function setup() {
  const spawned: unknown[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "pr-review",
    settings: { project: "deleted-project" },
    sdk: {
      system: { config: async () => ({ primaryHostId: "h1" }) },
      projects: { list: async () => [{ id: "personal", kind: "personal" }] },
      threads: {
        spawn: async (input) => {
          spawned.push(input);
          return { id: "review-thread" };
        },
        get: async () => ({ environmentId: "e1" }),
      },
      environments: {
        get: async () => {
          return { path: null, hostId: "h1" };
        },
      },
    },
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      expect(hostId).toBe("h1");
      expect(input).toMatchObject({ root: null, url });
      const pr = {
        url,
        repository: "org/external",
        number: 42,
        title: "Fix",
        state: "OPEN",
        isDraft: true,
      };
      if (method === "linkedSummary") return pr;
      if (method === "linkedDetail")
        return {
          pr,
          body: "",
          baseRefName: "main",
          headRefName: "fix",
          repositoryRoot: null,
          baseRefOid: "a".repeat(40),
          headRefOid: "b".repeat(40),
          files: [],
        };
      if (method === "linkedContents") return { oldContents: "before", newContents: "after" };
      throw new Error(`Unexpected host call: ${method}`);
    },
  });
  await plugin(bb);
  return { harness, spawned };
}
it("loads standalone PR details without starting a thread or resolving the configured workspace", async () => {
  const { harness, spawned } = await setup();
  try {
    expect(await harness.behavior.callRpc("reviewDraftDetail", { url })).toMatchObject({
      pr: { title: "Fix" },
    });
    expect(spawned).toEqual([]);
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("projects.get")).toHaveLength(0);
    expect(await harness.behavior.callRpc("linkedList", { threadId: "review-thread" })).toEqual([]);
  } finally {
    await harness.lifecycle.dispose();
  }
});
