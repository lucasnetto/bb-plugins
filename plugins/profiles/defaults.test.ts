import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";

for (const profile of ["personal", "work"] as const) {
  void test(`${profile} selects Profiles on a fresh install with an untouched header`, async () => {
    const root = mkdtempSync(join(tmpdir(), "bb-profiles-defaults-"));
    const { bb, harness } = createFakePluginHost({
      pluginId: "profiles",
      dataDir: join(root, profile === "personal" ? ".bb" : ".bb-work"),
      sdk: {
        system: {
          uiPreferences: {
            list: () => ({
              preferences: { "sidebar.headerProvider": { revision: 0, value: "__builtin__" } },
            }),
            set: () => ({}),
          },
        },
      },
    });
    try {
      await plugin(bb);
      assert.equal(harness.inspection.sdk.callsTo("system.uiPreferences.set").length, 0);
      await harness.lifecycle.install();
      assert.deepEqual(harness.inspection.sdk.callsTo("system.uiPreferences.set"), [
        [
          {
            key: "sidebar.headerProvider",
            expectedRevision: 0,
            value: "profiles/profiles",
          },
        ],
      ]);
    } finally {
      await harness.lifecycle.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const header of [
  { revision: 2, value: "__builtin__" },
  { revision: 0, value: "another/header" },
  { revision: 1, value: "profiles/profiles" },
]) {
  void test(`install preserves the selected header ${header.value} at revision ${header.revision}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "bb-profiles-defaults-"));
    const { bb, harness } = createFakePluginHost({
      pluginId: "profiles",
      dataDir: join(root, ".bb"),
      sdk: {
        system: {
          uiPreferences: {
            list: () => ({ preferences: { "sidebar.headerProvider": header } }),
          },
        },
      },
    });
    try {
      await plugin(bb);
      await harness.lifecycle.install();
      assert.equal(harness.inspection.sdk.callsTo("system.uiPreferences.set").length, 0);
    } finally {
      await harness.lifecycle.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
