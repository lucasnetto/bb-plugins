import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../../src/server/server.ts";

const request = {
  projectId: "selected-project",
  providerId: "codex",
  model: "gpt-5.6-sol",
  reasoningLevel: "high",
  serviceTier: "fast",
  permissionMode: "accept-edits",
  executionInputSources: {
    providerId: "explicit",
    model: "explicit",
    reasoningLevel: "explicit",
    serviceTier: "explicit",
    permissionMode: "client-preference",
  },
  environment: {
    type: "host",
    hostId: "selected-host",
    workspace: {
      type: "managed-worktree",
      baseBranch: { kind: "named", name: "develop" },
    },
  },
  input: [
    {
      type: "text",
      text: "Review @thread",
      mentions: [
        {
          start: 7,
          end: 14,
          resource: { kind: "thread", label: "thread", threadId: "thread-reference" },
        },
      ],
    },
    { type: "image", url: "data:image/png;base64,AAAA" },
    { type: "localImage", path: "/tmp/image.png" },
    {
      type: "localFile",
      path: "/tmp/report.txt",
      name: "report.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
    },
  ],
};

test("new thread preserves native composer selections, provenance, prompt variants, and scheduling", async () => {
  const spawned = [];

  const { bb, harness } = createFakePluginHost({
    pluginId: "t3-sidebar",
    sdk: {
      threads: {
        spawn: async (input) => {
          spawned.push(input);

          return { id: "created-thread" };
        },
      },
    },
  });

  try {
    await plugin(bb);

    for (const environment of [
      request.environment,
      { type: "host", hostId: "selected-host", workspace: { type: "unmanaged", path: null } },
      { type: "reuse", environmentId: "existing-environment" },
      { type: "project-default" },
      { type: "host", workspace: { type: "personal" } },
    ]) {
      const submitted = {
        ...request,
        environment,
        sendAt: 2_000_000_000_000,
      };

      assert.deepEqual(
        await harness.behavior.callRpc("project_thread_create", { request: submitted }),
        { id: "created-thread" },
      );
      assert.deepEqual(spawned.at(-1), {
        ...submitted,
        origin: "plugin",
        originPluginId: "t3-sidebar",
      });
    }
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("new thread rejects malformed RPC payloads before spawning and propagates host failures", async () => {
  let spawnCount = 0;

  const { bb, harness } = createFakePluginHost({
    pluginId: "t3-sidebar",
    sdk: {
      threads: {
        spawn: async () => {
          spawnCount++;
          throw new Error("Workspace unavailable");
        },
      },
    },
  });

  try {
    await plugin(bb);

    for (const invalid of [
      null,
      {},
      { ...request, projectId: "" },
      { ...request, permissionMode: "invalid" },
      { ...request, executionInputSources: { model: "invented-source" } },
      { ...request, environment: null },
      { ...request, environment: { type: "invalid" } },
      { ...request, input: [{ type: "invalid" }] },
      { ...request, title: "Unexpected override" },
    ]) {
      await assert.rejects(harness.behavior.callRpc("project_thread_create", { request: invalid }));
    }

    assert.equal(spawnCount, 0);
    await assert.rejects(
      harness.behavior.callRpc("project_thread_create", { request }),
      /Workspace unavailable/,
    );
    assert.equal(spawnCount, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});
