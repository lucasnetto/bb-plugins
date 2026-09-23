import { afterEach, expect, test } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import plugin from "../server";

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

async function setup() {
  let target = makeThreadResponse({ id: "child", parentThreadId: "parent", visibility: "visible" });

  const { bb, harness } = createFakePluginHost({
    pluginId: "workers",
    agentSkillIds: ["bb-workers", "fusion"],
    sdk: {
      threads: {
        get: async () => target,
        update: async ({ visibility }) => {
          target = { ...target, visibility: visibility ?? target.visibility };

          return target;
        },
      },
    },
  });

  await plugin(bb);
  disposers.push(() => harness.lifecycle.dispose());

  return {
    harness,
    created: (parentThreadId: string | null = "parent") =>
      harness.behavior.emitThreadEvent("thread.created", {
        thread: makeThreadResponse({ id: "child", parentThreadId }),
      }),
    setTarget: (patch: Partial<typeof target>) => {
      target = { ...target, ...patch };
    },
    convert: (caller = "parent") =>
      harness.behavior.callAgentTool(
        "bb_convert_to_worker",
        { threadId: "child" },
        { threadId: caller },
      ),
  };
}

test("converts a verified visible child without changing execution or parent; retries are idempotent", async () => {
  const { harness, created, convert } = await setup();
  await created();
  const result = await convert();

  expect(JSON.parse(z.string().parse(result))).toEqual({
    threadId: "child",
    parentThreadId: "parent",
    visibility: "hidden",
  });
  await convert();
  expect(harness.inspection.sdk.callsTo("threads.update")).toEqual([
    [{ threadId: "child", visibility: "hidden" }],
  ]);
  expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  expect(harness.realtimeSignals.length).toBeGreaterThan(0);
});

test("creation ownership survives reload", async () => {
  const { harness, created } = await setup();
  await created();
  const next = await harness.lifecycle.reload(plugin);
  disposers.push(() => next.harness.lifecycle.dispose());
  await next.harness.behavior.callAgentTool(
    "bb_convert_to_worker",
    { threadId: "child" },
    { threadId: "parent" },
  );
  expect(next.harness.inspection.sdk.callsTo("threads.update")).toHaveLength(1);
});

test("rejects unverified older children rather than trusting the mutable parent link", async () => {
  const { harness, convert } = await setup();
  await expect(convert()).rejects.toThrow("verified");
  expect(harness.inspection.sdk.callsTo("threads.update")).toHaveLength(0);
});

test("rejects self, other callers, and caller-supplied authorization fields", async () => {
  const { harness, created, convert } = await setup();
  await created();
  await expect(convert("child")).rejects.toThrow("itself");
  await expect(convert("other")).rejects.toThrow("verified");

  for (const input of [
    { threadId: "" },
    { threadId: "child", parentThreadId: "parent" },
    { threadId: "child", visibility: "visible" },
  ]) {
    await expect(
      harness.behavior.callAgentTool("bb_convert_to_worker", input, { threadId: "parent" }),
    ).rejects.toThrow();
  }

  expect(harness.inspection.sdk.callsTo("threads.update")).toHaveLength(0);
});

test("reparenting roots or foreign children cannot grant conversion ownership", async () => {
  for (const originalParent of [null, "other", "grandchild-parent"]) {
    const { harness, created, convert } = await setup();
    await created(originalParent);
    await created("parent"); // A duplicate event must not overwrite the original owner.
    await expect(convert()).rejects.toThrow("verified");
    expect(harness.inspection.sdk.callsTo("threads.update")).toHaveLength(0);
  }
});

test("rejects children that have since moved or been deleted", async () => {
  for (const patch of [{ parentThreadId: "other" }, { parentThreadId: null }, { deletedAt: 1 }]) {
    const { harness, created, convert, setTarget } = await setup();
    await created();
    setTarget(patch);
    await expect(convert()).rejects.toThrow("direct child");
    expect(harness.inspection.sdk.callsTo("threads.update")).toHaveLength(0);
  }
});

test("preserves archived state and propagates update errors", async () => {
  const { harness, created, convert, setTarget } = await setup();
  await created();
  setTarget({ archivedAt: 1 });
  harness.sdk.stub("threads.update", async () => {
    throw new Error("update failed");
  });
  await expect(convert()).rejects.toThrow("update failed");
});
