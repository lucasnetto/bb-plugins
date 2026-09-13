import { expect, test, vi } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/server";

const available = {
  id: "one",
  archivedAt: null,
  deletedAt: null,
  hasPendingInteraction: false,
  queuedWork: "none",
};

test("snoozes persist across reload; wake events and manual wake consume the timer", async () => {
  let { bb, harness } = createFakePluginHost({
    pluginId: "t3-sidebar",
    sdk: {
      threads: { list: async () => [available, { ...available, id: "two" }] },
    },
  });

  try {
    await plugin(bb);
    const until = Date.now() + 3_600_000;
    await Promise.all(
      ["one", "two"].map((threadId) =>
        harness.behavior.callRpc("snoozed_set", { threadId, until }),
      ),
    );
    ({ harness } = await harness.lifecycle.reload(plugin));
    expect(
      Object.keys((await harness.behavior.callRpc("snoozed_list", null)).snoozed),
    ).toHaveLength(2);
    await harness.behavior.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "one" }),
    });
    let result = await harness.behavior.callRpc("snoozed_list", null);
    expect(result.snoozed.one.until).toBeLessThan(until);
    expect(result.snoozed.two.until).toBe(until);
    await harness.behavior.callRpc("snoozed_set", { threadId: "two", until: null });
    result = await harness.behavior.callRpc("snoozed_list", null);
    expect(result.snoozed.two.until).toBeLessThan(until);
    await harness.behavior.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({ id: "one" }),
    });
    expect((await harness.behavior.callRpc("snoozed_list", null)).snoozed.one).toBeUndefined();
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("rejects past times, unavailable threads, input requests and queued work without writes", async () => {
  const list = vi.fn(async () => [available]);

  const { bb, harness } = createFakePluginHost({
    pluginId: "t3-sidebar",
    sdk: { threads: { list } },
  });

  try {
    await plugin(bb);

    const snooze = (until = Date.now() + 3_600_000) =>
      harness.behavior.callRpc("snoozed_set", { threadId: "one", until });

    await expect(snooze(0)).rejects.toThrow();

    for (const change of [
      { hasPendingInteraction: true },
      { queuedWork: "waiting" },
      { archivedAt: 1 },
    ]) {
      list.mockResolvedValue([{ ...available, ...change }]);
      await expect(snooze()).rejects.toThrow();
    }

    expect((await harness.behavior.callRpc("snoozed_list", null)).snoozed).toEqual({});
  } finally {
    await harness.lifecycle.dispose();
  }
});
