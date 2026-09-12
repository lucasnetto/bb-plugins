import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeHostResponse,
  makeMessageDispatchHookContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { createTaskPolicy, DELETE_GRACE_MS } from "../task-policy.ts";
import { TASK_PROVIDER, taskOwner, taskResource } from "../task-vms.ts";

function fixture() {
  const dataDir = "/tmp/orbisa-policy-test/.bb";
  const owner = taskOwner(dataDir);
  const resource = { ...taskResource(owner, "thr_task"), vmId: "vm_task" };
  const host = makeHostResponse({ id: "host_task", machineProviderId: TASK_PROVIDER });
  let root = makeThreadResponse({
    id: "thr_task",
    archivedAt: null,
    environmentId: "env_task",
    status: "idle",
  });
  let clock = 1_000_000;
  let live = 1;
  let starting = 0;
  let active = 0;
  let unavailable = false;
  let idleMinutes = 15;
  const { bb, harness } = createFakePluginHost({
    pluginId: "orbisa",
    dataDir,
    machineResource: async () => resource,
    sdk: {
      hosts: {
        list: async () => [host],
        get: async () => ({ ...host, connectMachineId: null }),
        delete: async () => ({ ok: true }),
        experimental_suspend: async () => host,
      },
      environments: {
        list: async () => [
          makeMessageDispatchHookContext({ environment: { id: "env_task", hostId: host.id } })
            .environment!,
        ],
      },
      threads: {
        list: async (args) => {
          assert.equal(args?.includeHidden, true);
          if (unavailable) throw new Error("unavailable");
          const rows = [];
          if (root.archivedAt === null)
            rows.push({ ...root, status: active ? ("active" as const) : root.status });
          if (root.archivedAt !== null && live > 0)
            rows.push(
              makeThreadResponse({
                id: "thr_hidden",
                environmentId: "env_task",
                visibility: "hidden",
                status: active ? "active" : "idle",
              }),
            );
          if (starting)
            rows.push(
              makeThreadResponse({
                id: "thr_starting",
                status: "starting",
                environmentId: null,
                visibility: "hidden",
              }),
            );
          return rows.slice(args?.offset ?? 0, (args?.offset ?? 0) + (args?.limit ?? 100));
        },
      },
    },
  });
  const factory = () =>
    createTaskPolicy(
      bb,
      owner,
      async () => idleMinutes,
      () => clock,
    );
  const policy = factory();
  return {
    bb,
    harness,
    policy,
    host,
    factory,
    advance: (ms: number) => {
      clock += ms;
    },
    settle: () => {
      live = 0;
      root = { ...root, archivedAt: clock };
    },
    unsettle: () => {
      live = 1;
      root = { ...root, archivedAt: null };
    },
    setLive: (value: number) => {
      live = value;
    },
    setStarting: (value: number) => {
      starting = value;
    },
    setActive: (value: number) => {
      active = value;
    },
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    setIdleMinutes: (value: number) => {
      idleMinutes = value;
    },
    removals: () => harness.inspection.sdk.callsTo("hosts.delete").length,
    suspensions: () => harness.inspection.sdk.callsTo("hosts.experimental_suspend").length,
  };
}

void test("settling starts a full ten-minute window; no dirty-Git checks precede deletion", async () => {
  const f = fixture();
  try {
    await f.policy.reconcile();
    f.settle();
    await f.policy.reconcile();
    const deadline = (await f.policy.read(f.host.id))?.deleteAt;
    assert.equal(deadline, 1_000_000 + DELETE_GRACE_MS);
    f.advance(DELETE_GRACE_MS - 1);
    await f.policy.reconcile();
    assert.equal(f.removals(), 0);
    f.advance(1);
    await f.policy.reconcile();
    assert.equal(f.removals(), 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("unsettling cancels deletion and settling again gets a new full window", async () => {
  const f = fixture();
  try {
    f.settle();
    await f.policy.reconcile();
    f.advance(DELETE_GRACE_MS - 1);
    f.unsettle();
    await f.policy.reconcile();
    assert.equal((await f.policy.read(f.host.id))?.deleteAt, null);
    f.advance(DELETE_GRACE_MS);
    await f.policy.reconcile();
    assert.equal(f.removals(), 0);
    f.settle();
    await f.policy.reconcile();
    f.advance(DELETE_GRACE_MS - 1);
    await f.policy.reconcile();
    assert.equal(f.removals(), 0);
    f.advance(1);
    await f.policy.reconcile();
    assert.equal(f.removals(), 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("other live owners, including hidden workers, retain a settled task machine", async () => {
  const f = fixture();
  try {
    f.settle();
    f.setLive(1);
    await f.policy.reconcile();
    f.advance(DELETE_GRACE_MS * 2);
    await f.policy.reconcile();
    assert.equal((await f.policy.read(f.host.id))?.deleteAt, null);
    assert.equal(f.removals(), 0);
    f.setLive(0);
    await f.policy.reconcile();
    assert.notEqual((await f.policy.read(f.host.id))?.deleteAt, null);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("starting launches and failed observations defer removal", async () => {
  const f = fixture();
  try {
    f.settle();
    await f.policy.reconcile();
    f.advance(DELETE_GRACE_MS);
    f.setStarting(1);
    await f.policy.reconcile();
    assert.equal(f.removals(), 0);
    f.setStarting(0);
    f.setUnavailable(true);
    await assert.rejects(f.policy.reconcile());
    assert.equal(f.removals(), 0);
    f.setUnavailable(false);
    await f.policy.reconcile();
    assert.equal(f.removals(), 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("deadline survives plugin reload and startup recovery", async () => {
  const f = fixture();
  let current = f.harness;
  try {
    f.settle();
    await f.policy.reconcile();
    f.advance(DELETE_GRACE_MS - 1);
    let policy = f.policy;
    const replacement = await f.harness.lifecycle.reload((bb) => {
      policy = createTaskPolicy(
        bb,
        taskOwner("/tmp/orbisa-policy-test/.bb"),
        async () => 15,
        () => 1_000_000 + DELETE_GRACE_MS,
      );
    });
    current = replacement.harness;
    await policy.reconcile();
    assert.equal(current.inspection.sdk.callsTo("hosts.delete").length, 1);
  } finally {
    await current.lifecycle.dispose();
  }
});

void test("active turns and terminal input extend idle time; zero disables suspension", async () => {
  const f = fixture();
  try {
    await f.policy.reconcile();
    f.advance(15 * 60_000);
    f.setActive(1);
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 0);
    f.setActive(0);
    f.advance(14 * 60_000);
    await f.policy.bump(f.host.id);
    f.advance(14 * 60_000);
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 0);
    f.advance(60_000);
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 1);
    f.setIdleMinutes(0);
    f.advance(60 * 60_000);
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("fresh ownership at the deletion boundary prevents removal", async () => {
  const f = fixture();
  try {
    f.settle();
    await f.policy.reconcile();
    f.advance(DELETE_GRACE_MS);
    let reads = 0;
    f.harness.inspection.sdk.stub("threads.list", async () => {
      return ++reads === 1
        ? []
        : [
            makeThreadResponse({
              id: "thr_new_owner",
              environmentId: "env_task",
              visibility: "hidden",
            }),
          ];
    });
    await f.policy.reconcile();
    assert.equal(f.removals(), 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("an active hidden owner beyond the first page prevents suspension and retirement", async () => {
  const f = fixture();
  try {
    f.settle();
    const rows = Array.from({ length: 100 }, (_, index) =>
      makeThreadResponse({ id: `thr_unrelated_${index}`, environmentId: null }),
    );
    rows.push(
      makeThreadResponse({
        id: "thr_last_hidden",
        environmentId: "env_task",
        visibility: "hidden",
        status: "active",
      }),
    );
    f.harness.inspection.sdk.stub(
      "threads.list",
      async (args: { offset?: number; limit?: number; includeHidden?: boolean } | undefined) => {
        assert.equal(args?.includeHidden, true);
        return rows.slice(args?.offset ?? 0, (args?.offset ?? 0) + (args?.limit ?? 100));
      },
    );
    await f.policy.reconcile();
    f.advance(60 * 60_000);
    await f.policy.reconcile();
    assert.equal((await f.policy.read(f.host.id))?.deleteAt, null);
    assert.equal(f.removals(), 0);
    assert.equal(f.suspensions(), 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
