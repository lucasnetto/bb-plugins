import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import {
  createFakePluginHost,
  makeHostResponse,
  makeMessageDispatchHookContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { createPersistentRuntimeCleanup } from "../persistent-runtime-cleanup.ts";
import { PERSISTENT_PROVIDER } from "../persistent-resource.ts";

void test("idle cleanup preserves machines and history, defers busy work, and runs once per dispatch", async () => {
  let clock = 1_000_000;
  let busy = false;
  let queued = false;
  let terminal = false;
  let terminalInput = 1_000_000;
  let reaped = 0;
  let stopFailure = false;
  let hidden = false;
  let background = 0;
  let interaction = false;
  const host = makeHostResponse({ id: "host_vm", machineProviderId: PERSISTENT_PROVIDER });

  const thread = () => ({
    ...makeThreadResponse({
      id: "thr_idle",
      status: busy ? "active" : "idle",
      updatedAt: 1_000_000,
    }),
    environmentHostId: host.id,
    visibility: hidden ? "hidden" : "visible",
    queuedWork: queued ? "waiting" : "none",
    hasPendingInteraction: interaction,
    activity: {
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: background,
      activeGoalCount: 0,
      activePlanModeCount: 0,
      activeWorkflowCount: 0,
    },
  });

  const { bb, harness } = createFakePluginHost({
    pluginId: "orbisa",
    sdk: {
      hosts: {
        list: async () => [host, makeHostResponse({ id: "host_old", machineProviderId: "manual" })],
      },
      threads: {
        list: async () => [thread()],
        stop: async () => {
          if (stopFailure) throw new Error("secret failure");

          return { ok: true };
        },
      },
      environments: { list: async () => [] },
      terminals: {
        list: async () => ({
          sessions: terminal
            ? [
                {
                  id: "term_old",
                  status: "running",
                  createdAt: 1_000_000,
                  lastUserInputAt: terminalInput,
                },
              ]
            : [],
        }),
        close: async () => {
          terminal = false;

          return { id: "term_old", status: "exited" };
        },
      },
    },
  });

  const policy = createPersistentRuntimeCleanup(
    bb,
    async () => 15,
    () => clock,
    async () => {
      reaped++;
    },
  );

  const sweep = () => Effect.runPromise(policy.sweep());
  const stops = () => harness.inspection.sdk.callsTo("threads.stop").length;

  try {
    await sweep();
    assert.equal(stops(), 0);
    clock += 16 * 60_000;
    busy = true;
    await sweep();
    busy = false;
    queued = true;
    await sweep();
    queued = false;
    terminal = true;
    terminalInput = clock;
    await sweep();
    terminal = false;
    background = 1;
    await sweep();
    background = 0;
    interaction = true;
    await sweep();
    interaction = false;
    assert.equal(stops(), 0);
    terminal = true;
    terminalInput = 1_000_000;
    hidden = true;
    stopFailure = true;
    await sweep();
    assert.equal(stops(), 1);
    assert.equal(harness.inspection.sdk.callsTo("terminals.close").length, 1);
    assert.equal(reaped, 0);
    assert.ok(!JSON.stringify(harness.logEntries).includes("secret failure"));
    stopFailure = false;
    await sweep();
    assert.equal(stops(), 2);
    await sweep();
    assert.equal(stops(), 2);
    const hook = harness.inspection.registrations.hooks["message.dispatch"]!;
    await hook(makeMessageDispatchHookContext({ host }));
    await sweep();
    assert.equal(stops(), 2);
    clock += 16 * 60_000;
    await sweep();
    assert.equal(stops(), 3);
    assert.equal(reaped, 2);
    assert.equal(harness.inspection.sdk.callsTo("hosts.experimental_suspend").length, 0);
    assert.equal(harness.inspection.sdk.callsTo("threads.archive").length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});

void test("dispatch waits during cleanup and is rechecked even when a release fails", async () => {
  let clock = 1_000_000;
  const host = makeHostResponse({ id: "host_vm", machineProviderId: PERSISTENT_PROVIDER });
  let dispatch: Promise<unknown> | undefined;

  const { bb, harness } = createFakePluginHost({
    pluginId: "orbisa",
    sdk: {
      hosts: { list: async () => [host] },
      threads: {
        list: async () => [
          {
            ...makeThreadResponse({ id: "thr_idle", status: "idle", updatedAt: 1_000_000 }),
            environmentHostId: host.id,
            queuedWork: "none",
            hasPendingInteraction: false,
            activity: {
              activeBackgroundAgentCount: 0,
              activeBackgroundCommandCount: 0,
              activeGoalCount: 0,
              activePlanModeCount: 0,
              activeWorkflowCount: 0,
            },
          },
        ],
        stop: async () => {
          const hook = harness.inspection.registrations.hooks["message.dispatch"]!;
          const result = Promise.resolve(hook(makeMessageDispatchHookContext({ host })));
          dispatch = result;
          assert.equal((await result).action, "wait");
          throw new Error("release failed");
        },
      },
      terminals: { list: async () => ({ sessions: [] }) },
    },
  });

  const policy = createPersistentRuntimeCleanup(
    bb,
    async () => 15,
    () => clock,
  );

  try {
    clock += 16 * 60_000;
    await Effect.runPromise(policy.sweep());
    assert.ok(dispatch);
    assert.ok(harness.inspection.recheckCount > 0);
    const hook = harness.inspection.registrations.hooks["message.dispatch"]!;
    assert.equal((await hook(makeMessageDispatchHookContext({ host }))).action, "proceed");
  } finally {
    await harness.lifecycle.dispose();
  }
});
