import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost, makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { registerTaskProvider } from "../task-provider.ts";
import {
  taskOwner,
  taskResource,
  ownedResource,
  resourceSchema,
  type TaskDriver,
} from "../task-vms.ts";

void test("task resources cannot target shared slots, templates, or another instance", () => {
  const owner = taskOwner("/Users/example/.bb");
  const resource = taskResource(owner, "thr_task");
  assert.deepEqual(ownedResource(owner, resource), resource);

  for (const name of ["cursor-base", "180seg-orbisa-01", "ubuntu", "--all"]) {
    assert.throws(() => ownedResource(owner, { ...resource, name }));
  }

  assert.throws(() => ownedResource(taskOwner("/Users/example/.bb-work"), resource));
  assert.notEqual(resource.name, taskResource(owner, "thr_other").name);
  assert.equal(resource.name, taskResource(owner, "thr_task").name);
});

void test("creation checkpoints allocation before clone and VM identity before bootstrap", async () => {
  const events: string[] = [];

  const driver: TaskDriver = {
    available: async () => true,
    allocate: async (resource) => {
      events.push("allocate");

      return { ...resource, vmId: "vm_1" };
    },
    prepare: async () => {
      events.push("prepare");
    },
    executor: () => ({ exec: async () => ({ exitCode: 0 }) }),
    stop: async () => {
      events.push("stop");
    },
    remove: async () => {
      events.push("remove");
    },
  };

  const host = makeHostResponse({ id: "host_task", machineProviderId: "orbisa-task" });

  const { bb, harness } = createFakePluginHost({
    pluginId: "orbisa",
    dataDir: "/tmp/task-provider/.bb",
    machineBootstrap: {
      bootstrap: async () => {
        events.push("bootstrap");

        return { hostId: host.id };
      },
    },
    sdk: { hosts: { get: async () => ({ ...host, connectMachineId: null }) } },
  });

  try {
    registerTaskProvider(
      bb,
      async () => ({ taskTemplate: "cursor-base", taskIdleMinutes: 15 }),
      driver,
    );
    const provider = harness.inspection.registrations.machineProviders.get("orbisa-task")!;
    assert.equal(provider.ephemeral, false);
    assert.equal(
      harness.inspection.registrations.environmentCompositions.get("orbisa-task")
        ?.environmentProviderId,
      "orbisa-checkout",
    );

    const context: Parameters<typeof provider.create>[0] = {
      key: "thr_task",
      attempt: 1,
      inputs: null,
      signal: new AbortController().signal,
      report: { step() {}, log() {} },
      checkpoint: async (value) => {
        const resource = resourceSchema.parse(value);
        events.push(resource.vmId ? "checkpoint-vm" : "checkpoint-intent");
      },
    };

    const result = await provider.create(context);
    assert.equal(result.status, "created");
    const timings = await bb.storage.kv.get<string[]>(`task-timings/${host.id}`);
    assert.equal(timings?.length, 3);
    assert.match(timings![2]!, /^Timing: Machine enrollment and connection: \d+ms \(completed\)$/);
    assert.deepEqual(events, [
      "checkpoint-intent",
      "allocate",
      "checkpoint-vm",
      "prepare",
      "bootstrap",
    ]);

    if (result.status !== "created") throw new Error("Expected created");
    events.length = 0;
    await provider.suspend!({ ...context, hostId: host.id, resource: result.resource });
    assert.deepEqual(events, ["checkpoint-vm", "stop"]);
    events.length = 0;
    await provider.resume!({ ...context, hostId: host.id, resource: result.resource });
    assert.deepEqual(events, ["prepare", "checkpoint-vm", "bootstrap"]);
    driver.startDaemon = async () => {
      events.push("start-daemon");

      return true;
    };

    events.length = 0;
    await provider.resume!({ ...context, hostId: host.id, resource: result.resource });
    assert.deepEqual(events, ["prepare", "checkpoint-vm", "start-daemon"]);
    events.length = 0;
    await provider.remove({ ...context, hostId: host.id, resource: result.resource });
    assert.deepEqual(events, ["remove"]);
  } finally {
    await harness.lifecycle.dispose();
  }
});
