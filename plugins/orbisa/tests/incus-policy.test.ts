import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeHostResponse,
  makeMessageDispatchHookContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { createIncusPolicy, INCUS_DELETE_GRACE_MS } from "../incus-policy.ts";

function fixture() {
  let clock = 1_000_000;
  let host = makeHostResponse({ id: "host_guest", machineProviderId: "orbisa-incus" });
  let root = makeThreadResponse({ id: "thr_owner", environmentId: "env_guest", status: "idle" });
  let extra: (typeof root)[] = [];
  let includeRoot = true;
  const { bb, harness } = createFakePluginHost({
    pluginId: "orbisa",
    machineResource: async () => ({ owner: "ours", key: "thr_owner" }),
    sdk: {
      hosts: {
        list: async () => [host],
        get: async () => ({ ...host, connectMachineId: null }),
        experimental_suspend: async () => {
          host = { ...host, lifecycle: { ...host.lifecycle, phase: "suspended" } };
          return host;
        },
        delete: async () => {
          host = { ...host, lifecycle: { ...host.lifecycle, phase: "destroyed" } };
          return { ok: true };
        },
      },
      environments: {
        list: async () => [
          makeMessageDispatchHookContext({ environment: { id: "env_guest", hostId: host.id } })
            .environment!,
        ],
      },
      threads: {
        list: async (args) => {
          assert.equal(args?.includeHidden, true);
          const rows = [...(includeRoot ? [root] : []), ...extra].filter(
            (t) => (t.archivedAt !== null) === args?.archived,
          );
          return rows.slice(args?.offset ?? 0, (args?.offset ?? 0) + (args?.limit ?? 100));
        },
      },
    },
  });
  const owned = (value: unknown) => {
    const r = value as { owner: string; key: string };
    assert.equal(r.owner, "ours");
    return r;
  };
  const policy = createIncusPolicy(bb, owned, () => clock);
  return {
    bb,
    harness,
    policy,
    owned,
    now: () => clock,
    root: () => root,
    advance(ms: number) {
      clock += ms;
    },
    settle() {
      root = { ...root, archivedAt: clock };
    },
    unsettle() {
      root = { ...root, archivedAt: null };
    },
    extra(rows: typeof extra) {
      extra = rows;
    },
    forgetRoot() {
      includeRoot = false;
    },
    phase(phase: typeof host.lifecycle.phase) {
      host = { ...host, lifecycle: { ...host.lifecycle, phase } };
    },
    provider(id: string) {
      host = { ...host, machineProviderId: id };
    },
    removals: () => harness.inspection.sdk.callsTo("hosts.delete").length,
    suspensions: () => harness.inspection.sdk.callsTo("hosts.experimental_suspend").length,
  };
}

void test("archive stops compute and deletes all files only after ten minutes", async () => {
  const f = fixture();
  try {
    await f.harness.behavior.emitThreadEvent("thread.idle", {
      thread: f.root(),
      lastAssistantText: null,
    });
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 0);
    assert.equal(await f.policy.read("host_guest"), null);
    f.settle();
    await f.harness.behavior.emitThreadEvent("thread.archived", { thread: f.root() });
    assert.equal(f.suspensions(), 1);
    assert.deepEqual(await f.policy.read("host_guest"), {
      settledAt: f.now(),
      deleteAt: f.now() + INCUS_DELETE_GRACE_MS,
    });
    f.advance(INCUS_DELETE_GRACE_MS - 1);
    await f.harness.behavior.runSchedule("incus-archive-cleanup");
    assert.equal(f.removals(), 0);
    f.advance(1);
    await f.policy.reconcile();
    assert.equal(f.removals(), 1);
    assert.equal(f.suspensions(), 1);
    await f.policy.reconcile();
    assert.equal(f.removals(), 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("unarchive cancels retirement; rapid resettlement gets a full new grace", async () => {
  const f = fixture();
  try {
    f.settle();
    await f.policy.reconcile();
    f.advance(INCUS_DELETE_GRACE_MS - 1);
    f.unsettle();
    await f.harness.behavior.emitThreadEvent("thread.unarchived", { thread: f.root() });
    assert.equal(await f.policy.read("host_guest"), null);
    f.advance(INCUS_DELETE_GRACE_MS);
    await f.policy.reconcile();
    assert.equal(f.removals(), 0);
    f.settle();
    await f.policy.reconcile();
    const first = (await f.policy.read("host_guest"))!.deleteAt;
    f.advance(1000);
    f.unsettle();
    f.settle(); // Both notifications can arrive after the final DB state.
    await f.policy.reconcile();
    assert.equal((await f.policy.read("host_guest"))!.deleteAt, first + 1000);
    f.advance(INCUS_DELETE_GRACE_MS);
    await f.policy.reconcile();
    assert.equal(f.removals(), 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("hidden owners beyond page one and unattached launches protect compute", async () => {
  const f = fixture();
  try {
    f.settle();
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeThreadResponse({ id: `other_${i}`, environmentId: null }),
    );
    rows.push(
      makeThreadResponse({
        id: "hidden",
        visibility: "hidden",
        environmentId: "env_guest",
        status: "idle",
      }),
    );
    f.extra(rows);
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 0);
    assert.equal(await f.policy.read("host_guest"), null);
    f.extra([
      makeThreadResponse({
        id: "launch",
        visibility: "hidden",
        environmentId: null,
        status: "starting",
      }),
    ]);
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 0);
    f.extra([]);
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("saved deadlines survive reload, deleted archive rows, and startup recovery", async () => {
  const f = fixture();
  let harness = f.harness;
  try {
    f.settle();
    await f.policy.reconcile();
    f.forgetRoot();
    f.advance(INCUS_DELETE_GRACE_MS);
    const replacement = await harness.lifecycle.reload((bb) => {
      createIncusPolicy(bb, f.owned, f.now);
    });
    harness = replacement.harness;
    await harness.behavior.runService("incus-archive-recovery").done;
    assert.equal(harness.inspection.sdk.callsTo("hosts.delete").length, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

void test("startup recovers a missed archive notification from its original timestamp", async () => {
  const f = fixture();
  try {
    f.settle();
    f.advance(INCUS_DELETE_GRACE_MS);
    await f.harness.behavior.runService("incus-archive-recovery").done;
    assert.equal(f.removals(), 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("fresh live ownership on a newly attached environment cancels deletion", async () => {
  const f = fixture();
  try {
    f.settle();
    await f.policy.reconcile();
    f.advance(INCUS_DELETE_GRACE_MS);
    let reads = 0;
    f.harness.inspection.sdk.stub("threads.list", async (args?: { archived?: boolean }) => {
      if (args?.archived) return [f.root()];
      return ++reads === 1
        ? []
        : [makeThreadResponse({ id: "new_owner", environmentId: "new_env" })];
    });
    let envReads = 0;
    f.harness.inspection.sdk.stub("environments.list", async () =>
      ["env_guest", ...(++envReads > 1 ? ["new_env"] : [])].map(
        (id) =>
          makeMessageDispatchHookContext({ environment: { id, hostId: "host_guest" } })
            .environment!,
      ),
    );
    await f.policy.reconcile();
    assert.equal(f.removals(), 0);
    assert.equal(await f.policy.read("host_guest"), null);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("observation failures and a busy coordinator defer work without losing the deadline", async () => {
  const f = fixture();
  try {
    f.settle();
    let busy = true;
    f.harness.inspection.sdk.stub("hosts.experimental_suspend", async () => {
      if (busy) throw new Error("machine_busy");
      f.phase("suspended");
      return makeHostResponse();
    });
    await f.policy.reconcile();
    const state = await f.policy.read("host_guest");
    busy = false;
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 2);
    assert.deepEqual(await f.policy.read("host_guest"), state);
    f.advance(INCUS_DELETE_GRACE_MS);
    f.harness.inspection.sdk.stub("threads.list", async () => {
      throw new Error("offline");
    });
    await assert.rejects(f.policy.reconcile(), /offline/);
    assert.equal(f.removals(), 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("standalone empty machines and other providers are never retired", async () => {
  const f = fixture();
  try {
    f.forgetRoot();
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 0);
    assert.equal(await f.policy.read("host_guest"), null);
    f.extra([{ ...f.root(), archivedAt: f.now() }]);
    f.provider("orbisa-task");
    await f.policy.reconcile();
    assert.equal(f.suspensions(), 0);
    assert.equal(f.removals(), 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

void test("overlapping events serialize and do not suspend the same host twice", async () => {
  const f = fixture();
  try {
    f.settle();
    await Promise.all([f.policy.reconcile(), f.policy.reconcile(), f.policy.reconcile()]);
    assert.equal(f.suspensions(), 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
