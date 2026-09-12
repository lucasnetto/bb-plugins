import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
  makeMessageDispatchHookContext,
} from "@get-bb/plugin-sdk/testing";
import { createPersistentPolicy } from "../persistent-policy.ts";
import { PERSISTENT_PROVIDER } from "../persistent-resource.ts";

void test("persistent machines suspend after idle but are never retired, including with no threads", async () => {
  let clock = 1_000_000;
  let active = false;
  let starting = false;
  const host = makeHostResponse({ id: "host_03", machineProviderId: PERSISTENT_PROVIDER });
  const { bb, harness } = createFakePluginHost({
    pluginId: "orbisa",
    dataDir: "/tmp/persistent-policy/.bb",
    sdk: {
      hosts: {
        list: async () => [host],
        get: async () => ({ ...host, connectMachineId: null }),
        experimental_suspend: async () => host,
      },
      environments: {
        list: async () => [
          makeMessageDispatchHookContext({ environment: { id: "env_03", hostId: host.id } })
            .environment!,
        ],
      },
      threads: {
        list: async (args) => {
          assert.equal(args?.includeHidden, true);
          return active || starting
            ? [
                makeThreadResponse({
                  environmentId: "env_03",
                  status: starting ? "starting" : "active",
                  visibility: "hidden",
                }),
              ]
            : [];
        },
      },
    },
  });
  const policy = createPersistentPolicy(
    bb,
    async () => 15,
    () => clock,
  );
  try {
    await Effect.runPromise(policy.sweep());
    clock += 20 * 60_000;
    active = true;
    await Effect.runPromise(policy.sweep());
    assert.equal(harness.inspection.sdk.callsTo("hosts.experimental_suspend").length, 0);
    active = false;
    clock += 14 * 60_000;
    await Effect.runPromise(policy.sweep());
    assert.equal(harness.inspection.sdk.callsTo("hosts.experimental_suspend").length, 0);
    clock += 2 * 60_000;
    starting = true;
    await Effect.runPromise(policy.sweep());
    assert.equal(harness.inspection.sdk.callsTo("hosts.experimental_suspend").length, 0);
    starting = false;
    await Effect.runPromise(policy.sweep());
    assert.equal(harness.inspection.sdk.callsTo("hosts.experimental_suspend").length, 1);
    assert.equal(harness.inspection.sdk.callsTo("hosts.delete").length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});
