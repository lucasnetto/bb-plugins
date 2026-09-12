import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  createFakePluginHost,
  makeMessageDispatchHookContext,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";

void test("central server registers the wake admission hook", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "orbisa", dataDir: "/tmp/orbisa-test/.bb" });
  plugin(bb);
  try {
    assert.notEqual(harness.inspection.registrations.hooks["message.dispatch"], null);
    assert.equal((await harness.behavior.runCli(["open", "cursor-base"])).exitCode, 1);
    assert.equal(
      (await harness.behavior.runCli(["bind", "180seg-orbisa-01", "host_1"])).exitCode,
      1,
    );
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

void test("unbound and connected machines proceed without a wake", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "orbisa", dataDir: "/tmp/orbisa-test/.bb" });
  plugin(bb);
  try {
    await bb.storage.kv.set("bindings", { host_vm: "180seg-orbisa-01" });
    const hook = harness.inspection.registrations.hooks["message.dispatch"]!;
    for (const host of [
      null,
      { id: "host_mac", status: "disconnected" as const },
      { id: "host_vm", status: "connected" as const },
    ]) {
      assert.deepEqual(await hook(makeMessageDispatchHookContext({ host })), { action: "proceed" });
    }
    assert.equal(harness.inspection.recheckCount, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});
