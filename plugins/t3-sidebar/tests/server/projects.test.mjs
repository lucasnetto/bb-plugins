import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/server.ts";

test("project controls route folders and mutations through BB and protect personal projects", async () => {
  const created = [];
  const deleted = [];

  const { bb, harness } = createFakePluginHost({
    pluginId: "t3-sidebar",
    sdk: {
      hosts: {
        list: async () => [
          { id: "online", name: "Laptop", status: "connected" },
          { id: "offline", name: "Other", status: "disconnected" },
        ],
        directory: async ({ hostId, path }) => {
          assert.equal(hostId, "online");
          assert.equal(path, "/work");

          return {
            directory: "/work",
            parent: "/",
            entries: [
              { name: "file.txt", path: "/work/file.txt", kind: "file" },
              { name: "repo", path: "/work/repo", kind: "directory" },
            ],
          };
        },
      },
      projects: {
        list: async () => [
          { id: "personal", kind: "personal" },
          { id: "project", kind: "standard" },
        ],
        create: async (args) => {
          created.push(args);

          return { id: "created" };
        },
        delete: async (args) => {
          deleted.push(args);
        },
      },
    },
  });

  try {
    await plugin(bb);
    assert.deepEqual(await harness.behavior.callRpc("project_hosts", null), [
      { id: "online", name: "Laptop" },
    ]);
    assert.deepEqual(
      await harness.behavior.callRpc("project_directory", {
        hostId: "online",
        path: "/work",
      }),
      {
        directory: "/work",
        parent: "/",
        entries: [{ name: "repo", path: "/work/repo" }],
      },
    );
    assert.deepEqual(
      await harness.behavior.callRpc("project_create", {
        hostId: "online",
        path: "/work/repo/",
      }),
      { id: "created" },
    );
    assert.deepEqual(created, [
      {
        name: "repo",
        source: { type: "local_path", hostId: "online", path: "/work/repo/" },
      },
    ]);
    await assert.rejects(harness.behavior.callRpc("project_remove", { projectId: "personal" }));
    await assert.rejects(harness.behavior.callRpc("project_remove", { projectId: "missing" }));
    assert.deepEqual(deleted, []);
    await harness.behavior.callRpc("project_remove", { projectId: "project" });
    assert.deepEqual(deleted, [{ projectId: "project" }]);
  } finally {
    await harness.lifecycle.dispose();
  }
});
