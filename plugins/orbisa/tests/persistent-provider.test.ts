import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerPersistentProvider, type PersistentAdapters } from "../persistent-provider.ts";
import {
  ownedPersistentResource,
  persistentResource,
  persistentInputs,
  PERSISTENT_PROVIDER,
} from "../persistent-resource.ts";

void test("each profile owns only its assigned persistent slots", () => {
  for (const [profile, slots] of [
    [".bb", ["01"]],
    [".bb-work", ["01", "02"]],
  ] as const) {
    const dir = `/tmp/persistent/${profile}`;
    for (const slot of ["01", "02", "03"] as const) {
      assert.equal(
        persistentInputs(dir).safeParse({ slot }).success,
        (slots as readonly string[]).includes(slot),
      );
      if ((slots as readonly string[]).includes(slot)) {
        const resource = persistentResource(dir, "launch", slot);
        assert.deepEqual(ownedPersistentResource(dir, resource), resource);
        for (const name of [
          "180seg-orbisa-01",
          "cursor-base",
          "180seg-orbisa-base",
          "bb-task-other",
        ]) {
          assert.throws(() => ownedPersistentResource(dir, { ...resource, name }));
        }
      } else assert.throws(() => persistentResource(dir, "launch", slot));
    }
  }
});

function fixture() {
  const events: string[] = [];
  let exists = false;
  const { bb, harness } = createFakePluginHost({
    pluginId: "orbisa",
    dataDir: "/tmp/persistent-test/.bb",
    machineBootstrap: {
      bootstrap: async () => {
        events.push("bootstrap");
        return { hostId: "host_vm" };
      },
    },
  });
  const adapters: PersistentAdapters = {
    exists: async () => exists,
    seed: () =>
      Effect.sync(() => {
        events.push("seed");
      }),
    driver: {
      available: async () => true,
      allocate: async (resource) => {
        events.push("allocate");
        exists = true;
        return { ...resource, vmId: "vm_01" };
      },
      prepare: async (_resource, _signal, _report, removing) => {
        events.push(removing ? "prepare-removal" : "prepare");
      },
      executor: () => ({ exec: async () => ({ exitCode: 0 }) }),
      stop: async () => {
        events.push("stop");
      },
      remove: async (resource) => {
        assert.equal(resource.vmId, "vm_01");
        events.push("remove");
        exists = false;
      },
    },
  };
  registerPersistentProvider(bb, async () => ({ persistentIdleMinutes: 15 }), adapters);
  const provider = harness.inspection.registrations.machineProviders.get(PERSISTENT_PROVIDER)!;
  const context = {
    key: "launch_01",
    attempt: 1,
    inputs: { slot: "01" },
    signal: new AbortController().signal,
    report: { step() {}, log() {} },
    checkpoint: async (value: unknown) => {
      events.push((value as { vmId: string | null }).vmId ? "checkpoint-vm" : "checkpoint-intent");
    },
  };
  return {
    bb,
    harness,
    provider,
    context,
    events,
    foreignVm: () => {
      exists = true;
    },
  };
}

void test("persistent create is checkpointed; duplicate launches cannot adopt or clean up its VM", async () => {
  const f = fixture();
  try {
    assert.equal(f.provider.ephemeral, false);
    const result = await f.provider.create(f.context);
    assert.equal(result.status, "created");
    assert.deepEqual(f.events, [
      "checkpoint-intent",
      "allocate",
      "checkpoint-vm",
      "prepare",
      "seed",
      "bootstrap",
    ]);
    await assert.rejects(
      f.provider.create({ ...f.context, key: "duplicate" }),
      /already has a BB machine/,
    );
    f.events.length = 0;
    await f.provider.reconcileCleanup({ ...f.context, key: "duplicate" });
    assert.deepEqual(f.events, []);
    if (result.status !== "created") throw new Error("Expected created");
    await f.provider.suspend!({ ...f.context, hostId: "host_vm", resource: result.resource });
    assert.deepEqual(f.events, ["checkpoint-vm", "stop"]);
    f.events.length = 0;
    // Reconcile uses the latest saved identity even when launch metadata predates allocation.
    await f.provider.reconcileCleanup(f.context);
    await f.provider.reconcileCleanup(f.context);
    assert.deepEqual(f.events, ["remove"]);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("an existing unowned VM cannot be adopted or deleted after create fails", async () => {
  const f = fixture();
  f.foreignVm();
  try {
    await assert.rejects(f.provider.create(f.context), /without a matching BB ownership/);
    await f.provider.reconcileCleanup(f.context);
    assert.deepEqual(f.events, []);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("resume refreshes credentials and reconnects without reseeding repositories", async () => {
  const f = fixture();
  try {
    const result = await f.provider.create(f.context);
    if (result.status !== "created") throw new Error("Expected created");
    f.harness.inspection.sdk.stub("hosts.get", async () => ({ lifecycle: { phase: "suspended" } }));
    f.events.length = 0;
    await f.provider.resume!({ ...f.context, hostId: "host_vm", resource: result.resource });
    assert.deepEqual(f.events, ["prepare", "checkpoint-vm", "bootstrap"]);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
