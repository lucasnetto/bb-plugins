import { expect, it } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import plugin from "../../server";

const url = "https://github.com/org/external/pull/42";
const request: NewThreadRequest = {
  projectId: "personal",
  providerId: "codex",
  model: "chosen-model",
  reasoningLevel: "high",
  permissionMode: "auto",
  executionInputSources: { model: "explicit", providerId: "explicit" },
  environment: { type: "host", hostId: "h1", workspace: { type: "personal" } },
  input: [{ type: "text", text: "Can this fail when the value is null?", mentions: [] }],
};
async function setup(failLink = false) {
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
          if (failLink) throw new Error("offline");
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
it("loads a draft without starting a thread or resolving the configured workspace", async () => {
  const { harness, spawned } = await setup();
  try {
    expect(await harness.behavior.callRpc("reviewDraftDefaults", null)).toEqual({
      projectId: "personal",
      hostId: "h1",
    });
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
it("starts only the submitted conversation, preserves model choices and links the PR manually", async () => {
  const { harness, spawned } = await setup();
  try {
    const comments = [
      {
        id: "c1",
        label: "api.ts · 12–14",
        text: "Check null handling",
        context: "Head: abc\nBase: def\nLines: 12–14\nselected code",
      },
    ];
    expect(await harness.behavior.callRpc("startReview", { url, request, comments })).toEqual({
      threadId: "review-thread",
      warning: null,
    });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({
      ...request,
      title: "org/external #42",
      input: [
        {
          type: "text",
          text: `Pull request: ${url}\n\napi.ts · 12–14\nCheck null handling\n\nSelected PR context:\n${comments[0]!.context}`,
          mentions: [],
        },
        ...request.input,
      ],
    });
    expect(JSON.stringify(spawned)).not.toContain("Review correctness");
    expect(
      await harness.behavior.callRpc("linkedList", { threadId: "review-thread" }),
    ).toMatchObject([{ reason: "manual", url }]);
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
  } finally {
    await harness.lifecycle.dispose();
  }
});
it("returns the created thread if linking fails, so Send cannot silently create a duplicate", async () => {
  const { harness, spawned } = await setup(true);
  try {
    expect(
      await harness.behavior.callRpc("startReview", { url, request, comments: [] }),
    ).toMatchObject({ threadId: "review-thread", warning: expect.stringContaining("offline") });
    expect(spawned).toHaveLength(1);
  } finally {
    await harness.lifecycle.dispose();
  }
});
it("rejects malformed URLs and empty submissions before creating a thread", async () => {
  const { harness, spawned } = await setup();
  try {
    await expect(
      harness.behavior.callRpc("startReview", {
        url: "https://evil.test/org/api/pull/42",
        request,
        comments: [],
      }),
    ).rejects.toThrow();
    await expect(
      harness.behavior.callRpc("startReview", {
        url,
        request: { ...request, input: [] },
        comments: [],
      }),
    ).rejects.toThrow();
    expect(spawned).toEqual([]);
  } finally {
    await harness.lifecycle.dispose();
  }
});
