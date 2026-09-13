import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../../src/server/server.ts";

test("project settings persist independently, rename through BB, and serialize concurrent patches", async () => {
  const projects = {
    one: {
      id: "one",
      name: "First",
      kind: "standard",
      sources: [{ hostId: "host", path: "/repo", isDefault: true }],
    },
    two: { id: "two", name: "Second", kind: "standard", sources: [] },
    personal: {
      id: "personal",
      name: "Personal",
      kind: "personal",
      sources: [],
    },
  };

  const model = {
    providerId: "codex",
    model: "gpt-5",
    reasoningLevel: "high",
    serviceTier: "default",
  };

  const renamed = [];

  const { bb, harness } = createFakePluginHost({
    pluginId: "t3-sidebar",
    sdk: {
      projects: {
        get: async ({ projectId }) => {
          if (!projects[projectId]) throw new Error("Missing");

          return projects[projectId];
        },
        defaultExecutionOptions: async () => model,
        update: async ({ projectId, name }) => {
          renamed.push({ projectId, name });
          projects[projectId].name = name;

          return projects[projectId];
        },
      },
    },
  });

  try {
    await plugin(bb);
    const get = (projectId) => harness.behavior.callRpc("project_settings_get", { projectId });

    const update = (patch) =>
      harness.behavior.callRpc("project_settings_update", {
        projectId: "one",
        ...patch,
      });

    const before = await get("one");
    assert.equal(before.workspace, "default");
    assert.equal(before.autoPull, false);
    assert.equal(before.model, null);
    assert.deepEqual(before.resolvedModel, model);
    await Promise.all([update({ workspace: "local" }), update({ autoPull: true })]);
    await update({
      name: "Renamed",
      model: { ...model, reasoningLevel: "low" },
    });
    assert.equal((await get("one")).workspace, "local");
    assert.equal((await get("one")).autoPull, true);
    assert.equal((await get("one")).model.reasoningLevel, "low");
    assert.equal((await get("two")).autoPull, false);
    assert.deepEqual(renamed, [{ projectId: "one", name: "Renamed" }]);
    await update({ model: null });
    assert.deepEqual((await get("one")).resolvedModel, model);
    await assert.rejects(update({ name: "   " }));
    await assert.rejects(
      harness.behavior.callRpc("project_settings_update", {
        projectId: "personal",
        name: "Oops",
      }),
    );
    await assert.rejects(
      harness.behavior.callRpc("project_settings_update", {
        projectId: "missing",
        workspace: "local",
      }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
