import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";

void test("task lifecycle remains available and retired commands are rejected", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "orbisa",
    dataDir: "/tmp/orbisa-test/.bb",
    sdk: { hosts: { list: async () => [] } },
  });

  plugin(bb);

  try {
    assert.ok(harness.inspection.registrations.hooks["message.dispatch"]);
    const tasks = await harness.behavior.runCli(["tasks"]);
    assert.equal(tasks.exitCode, 0);
    assert.deepEqual(JSON.parse(tasks.stdout!), { total: 0, machines: [] });
    const containers = await harness.behavior.runCli(["containers"]);
    assert.equal(containers.exitCode, 0);
    assert.deepEqual(JSON.parse(containers.stdout!), { total: 0, machines: [] });

    for (const argv of [["status"], ["bind", "retired-slot", "host_1"], ["wake", "retired-slot"]]) {
      const result = await harness.behavior.runCli(argv);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, "Usage: bb orbisa tasks|containers");
    }
  } finally {
    await harness.lifecycle.dispose();
  }
});

void test("plugin uses public SDK APIs", () => {
  const result = experimental_scanPublicSdkOnly(fileURLToPath(new URL("..", import.meta.url)), {
    allow: [/^react(?:\/|$)/, /^effect(?:\/|$)/],
  });

  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.privateDependencies, []);
});
