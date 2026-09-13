import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/server";

const providers = Array.from({ length: 5 }, (_, i) => ({
  id: String(i),
  displayName: `Provider ${i}`,
  available: true,
}));

test("catalog bounds provider reads, preserves order, and isolates provider failures", async () => {
  const ready = Promise.withResolvers();
  const release = Promise.withResolvers();
  let active = 0;
  let peak = 0;
  let started = 0;

  const { bb, harness } = createFakePluginHost({
    pluginId: "hide-models",
    sdk: {
      providers: {
        list: async () => providers,
        models: async ({ providerId }) => {
          started++;
          peak = Math.max(peak, ++active);

          if (started === 4) ready.resolve();

          try {
            await release.promise;

            if (providerId === "2") throw new Error("Provider unavailable");

            return { models: [], modelLoadError: null };
          } finally {
            active--;
          }
        },
      },
    },
  });

  try {
    plugin(bb);
    const pending = harness.behavior.callRpc("catalog", null);
    await ready.promise;
    assert.equal(started, 4);
    release.resolve();
    const result = await pending;
    assert.equal(peak, 4);
    assert.deepEqual(
      result.providers.map((p) => p.id),
      providers.map((p) => p.id),
    );
    assert.equal(result.providers[2].loadError, "Provider unavailable");
    assert.equal(result.providers.filter((p) => p.loadError === null).length, 4);
  } finally {
    release.resolve();
    await harness.lifecycle.dispose();
  }
});

test("disposing the plugin interrupts a pending catalog instead of returning partial rows", async () => {
  const ready = Promise.withResolvers();
  const release = Promise.withResolvers();

  const { bb, harness } = createFakePluginHost({
    pluginId: "hide-models",
    sdk: {
      providers: {
        list: async () => providers,
        models: async () => {
          ready.resolve();
          await release.promise;

          return { models: [] };
        },
      },
    },
  });

  try {
    plugin(bb);
    const rejected = assert.rejects(harness.behavior.callRpc("catalog", null));
    await ready.promise;
    await harness.lifecycle.dispose();
    await rejected;
  } finally {
    release.resolve();
    await harness.lifecycle.dispose();
  }
});

test("CLI mutations compose with storage effects and preserve concurrent hides", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "hide-models",
    sdk: {
      providers: {
        list: async () => [{ id: "test", displayName: "Test", available: true }],
        models: async () => ({
          models: ["one", "two"].map((model) => ({
            model,
            displayName: model,
            description: "",
            isDefault: false,
          })),
        }),
      },
    },
  });

  try {
    plugin(bb);

    const results = await Promise.all(
      ["one", "two"].map((model) => harness.behavior.runCli(["hide", "test", model, "--json"])),
    );

    assert.ok(results.every((result) => result.exitCode === 0));
    const { hidden } = await harness.behavior.callRpc("hidden_get", null);
    assert.deepEqual(hidden.map((entry) => entry.model).sort(), ["one", "two"]);
    const response = await harness.behavior.fetchHttp("GET", "/hidden");
    assert.deepEqual(await response.json(), { hidden });
    assert.equal((await harness.behavior.runCli(["show", "test", "one"])).exitCode, 0);
    assert.equal((await harness.behavior.callRpc("hidden_get", null)).hidden.length, 1);
    assert.equal((await harness.behavior.runCli(["show", "test", "one"])).exitCode, 1);
    assert.equal((await harness.behavior.runCli(["clear"])).exitCode, 0);
    assert.deepEqual(await harness.behavior.callRpc("hidden_get", null), { hidden: [] });
    await bb.storage.kv.set("hidden", { malformed: true });
    await assert.rejects(harness.behavior.callRpc("hidden_get", null));
  } finally {
    await harness.lifecycle.dispose();
  }
});
