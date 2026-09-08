import { expect, it } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { snapshotSchema } from "../contract";

it("persists list pages across reloads, skips fresh fetches, and preserves data on failure", async () => {
  let fail = false;
  let closed = false;
  let hostId = "h1";
  let requests = 0;
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  const row = (number: number) => ({
    url: `https://github.com/acme/api/pull/${number}`,
    repository: "acme/api",
    number,
    title: `PR ${number}`,
    author: "lucas",
    isDraft: false,
    updatedAt: "2026-09-07",
  });
  let { bb, harness } = createFakePluginHost({
    pluginId: "pr-review",
    sdk: {
      system: { config: async () => ({ primaryHostId: hostId }) },
    },
    experimental_callHostRpc: async ({ input }) => {
      requests++;
      if (gate) await gate;
      if (fail) throw new Error("GitHub unavailable");
      const page = (input as { page: number }).page;
      return {
        viewer: "lucas",
        rows: closed ? [] : [row(page)],
        total: closed ? 0 : 51,
        nextPage: !closed && page === 1 ? 2 : null,
        incomplete: false,
      };
    },
  });
  const read = async (view = "authored") =>
    snapshotSchema.parse(await harness.behavior.callRpc("savedList", { view }));
  const refresh = (force = true, loadMore = false) =>
    harness.behavior.callRpc("refreshList", { view: "authored", force, loadMore });
  try {
    await plugin(bb);
    expect((await read()).result).toBeNull();
    expect(requests).toBe(0);
    await refresh();
    expect((await read()).result?.rows).toEqual([row(1)]);
    expect(
      snapshotSchema.parse(
        await harness.behavior.callRpc("savedList", { view: "authored", state: "ready" }),
      ).result,
    ).toBeNull();
    await harness.behavior.callRpc("refreshList", {
      view: "authored",
      state: "ready",
      force: false,
      loadMore: false,
    });
    expect(
      snapshotSchema.parse(
        await harness.behavior.callRpc("savedList", { view: "authored", state: "ready" }),
      ).result?.rows,
    ).toEqual([row(1)]);
    await refresh(true, true);
    const saved = await read();
    expect(saved.result?.rows).toEqual([row(1), row(2)]);
    ({ bb, harness } = await harness.lifecycle.reload(plugin));
    expect(await read()).toEqual(saved);
    const before = requests;
    await refresh(false);
    expect(requests).toBe(before);
    expect((await read("reviewing")).result).toBeNull();
    hostId = "h2";
    expect((await read()).result).toBeNull();
    hostId = "h1";
    fail = true;
    await refresh();
    expect((await read()).result).toEqual(saved.result);
    expect((await read()).fetchedAt).toBe(saved.fetchedAt);
    expect((await read()).error).toContain("GitHub unavailable");
    fail = false;
    closed = true;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = refresh();
    const second = refresh();
    await read();
    const during = requests;
    release?.();
    await Promise.all([first, second]);
    expect(requests).toBe(during);
    expect((await read()).result?.rows).toEqual([]);
    expect((await read()).pageCount).toBe(1);
    expect((await read()).error).toBeNull();
    expect(harness.realtimeSignals.some((s) => s.channel === "pr-list-changed")).toBe(true);
  } finally {
    release?.();
    await harness.lifecycle.dispose();
  }
});
