import { expect, it } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";

const url = "https://github.com/org/repo/pull/42";

async function fixture(phase = "suspended", status = "disconnected") {
  const host = { id: "thread-host", name: "Review VM", lifecycle: { phase }, status };
  let finish!: () => void;
  let fail!: (error: Error) => void;

  const resumed = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });

  const fake = createFakePluginHost({
    pluginId: "pr-review",
    sdk: {
      threads: { get: async () => ({ environmentId: "env" }) },
      environments: { get: async () => ({ hostId: "thread-host", path: "/repo" }) },
      system: { config: async () => ({ primaryHostId: "primary-host" }) },
      hosts: {
        get: async () => host,
        experimental_resume: async () => {
          await resumed;

          return host;
        },
      },
    },
  });

  await plugin(fake.bb);

  const prepare = (wake: boolean, threadId: string | null = "thread") =>
    fake.harness.behavior.callRpc("prPrepare", { threadId, url, wake });

  return { ...fake, host, finish, fail, prepare };
}

it("shares concurrent wakes and waits for an active, connected host", async () => {
  const f = await fixture();

  try {
    expect(await Promise.all([f.prepare(true), f.prepare(true)])).toEqual([
      { status: "waking" },
      { status: "waking" },
    ]);
    expect(f.harness.inspection.sdk.callsTo("hosts.experimental_resume")).toHaveLength(1);
    expect(f.harness.inspection.sdk.callsTo("hosts.experimental_resume")[0]?.[0]).toEqual({
      hostId: "thread-host",
    });
    f.host.lifecycle.phase = "resuming";
    f.host.status = "connected";
    expect(await f.prepare(false)).toEqual({ status: "waking" });
    f.host.lifecycle.phase = "active";
    f.finish();
    expect(await f.prepare(false)).toEqual({ status: "ready" });
    expect(f.harness.inspection.experimental_hostRpcCalls).toHaveLength(0);
  } finally {
    f.finish();
    await f.harness.lifecycle.dispose();
  }
});

it("does not wake from polling and selects the primary host for standalone PRs", async () => {
  const f = await fixture();

  try {
    await expect(f.prepare(false, null)).rejects.toThrow("Retry to wake");
    expect(f.harness.inspection.sdk.callsTo("hosts.get")[0]?.[0]).toEqual({
      hostId: "primary-host",
    });
    expect(f.harness.inspection.sdk.callsTo("hosts.experimental_resume")).toHaveLength(0);
  } finally {
    f.finish();
    await f.harness.lifecycle.dispose();
  }
});

it.each(["active", "removing", "destroyed"])(
  "does not resume an unavailable %s host",
  async (phase) => {
    const f = await fixture(phase);

    try {
      await expect(f.prepare(true)).rejects.toThrow(phase === "active" ? "Reconnect it" : phase);
      expect(f.harness.inspection.sdk.callsTo("hosts.experimental_resume")).toHaveLength(0);
    } finally {
      f.finish();
      await f.harness.lifecycle.dispose();
    }
  },
);

it("reports resume failures without a polling retry loop", async () => {
  const f = await fixture();

  try {
    await f.prepare(true);
    f.fail(new Error("Provider unavailable"));
    await expect(f.prepare(false)).rejects.toThrow("Provider unavailable");
    await expect(f.prepare(false)).rejects.toThrow("Provider unavailable");
    expect(f.harness.inspection.sdk.callsTo("hosts.experimental_resume")).toHaveLength(1);
    await f.prepare(true);
    expect(f.harness.inspection.sdk.callsTo("hosts.experimental_resume")).toHaveLength(2);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

it("returns immediately for connected active hosts without a wake", async () => {
  const f = await fixture("active", "connected");

  try {
    expect(await f.prepare(true)).toEqual({ status: "ready" });
    expect(f.harness.inspection.sdk.callsTo("hosts.experimental_resume")).toHaveLength(0);
  } finally {
    f.finish();
    await f.harness.lifecycle.dispose();
  }
});
