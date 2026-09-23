import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerIncusProvider } from "../incus-provider.ts";

void test("Incus adapter checkpoints before remote CLI and enrolls through the SDK", async () => {
  const events: string[] = [];
  const calls: Array<{ hostId: string; action: string }> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "orbisa",
    dataDir: "/tmp/incus-test/.bb",
    experimental_callHostRpc: async ({ hostId, input }) => {
      const p = input as { action: string; command: string[]; stdin: string };
      calls.push({ hostId, action: p.action });
      events.push(p.action);
      if (p.action === "exec") {
        assert.deepEqual(p.command, ["sh", "-s"]);
        assert.equal(p.stdin, "private enrollment payload");
        return { exitCode: 0, stdout: "enrolled", stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          version: 1,
          ok: true,
          data: { id: "a".repeat(32), name: "orbisa-test" },
        }),
        stderr: "",
      };
    },
    machineBootstrap: {
      bootstrap: async ({ executor, signal }) => {
        events.push("bootstrap");
        const output: string[] = [];
        assert.deepEqual(
          await executor.exec({
            command: ["sh", "-s"],
            stdin: "private enrollment payload",
            timeoutMs: 1000,
            signal,
            onOutput: (t) => output.push(t),
          }),
          { exitCode: 0 },
        );
        assert.deepEqual(output, ["enrolled"]);
        return { hostId: "host_guest" };
      },
    },
  });
  try {
    registerIncusProvider(bb, {
      prepareCredentials: async () => {
        events.push("credentials");
      },
    });
    const p = harness.inspection.registrations.machineProviders.get("orbisa-incus")!;
    assert.equal(p.ephemeral, false);
    assert.equal(
      harness.inspection.registrations.environmentCompositions.get("orbisa-incus")
        ?.environmentProviderId,
      "project-checkout",
    );
    const context = {
      key: "allocation",
      attempt: 1,
      inputs: { runtimeHostId: "host_linux", image: "orbisa-tooling-v2" },
      signal: new AbortController().signal,
      report: { step() {}, log() {} },
      checkpoint: async (r: any) => {
        events.push(r.id ? "checkpoint-id" : "checkpoint-intent");
      },
    };
    const result = await p.create(context);
    assert.equal(result.status, "created");
    assert.deepEqual(events, [
      "checkpoint-intent",
      "create",
      "checkpoint-id",
      "start",
      "credentials",
      "bootstrap",
      "exec",
    ]);
    assert.ok(calls.every((c) => c.hostId === "host_linux"));
    if (result.status !== "created") throw new Error("create failed");
    events.length = 0;
    await p.suspend!({ ...context, hostId: "host_guest", resource: result.resource });
    assert.deepEqual(events, ["checkpoint-id", "stop"]);
    events.length = 0;
    await p.reconcileCleanup(context);
    assert.deepEqual(events, ["remove"]);
    await assert.rejects(
      p.remove({
        ...context,
        hostId: "host_guest",
        resource: { ...(result.resource as object), owner: "foreign" },
      }),
      /Foreign/,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
