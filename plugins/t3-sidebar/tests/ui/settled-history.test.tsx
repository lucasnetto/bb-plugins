// @vitest-environment jsdom
import { settledContract } from "../../src/shared/settled-contract";
import { expect, test, vi } from "vite-plus/test";
import { act, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { thread } from "./thread-fixture";
import { mergeSettledHistory } from "../../src/ui/lib/settled-history";
import { partitionThreads } from "../../src/ui/lib/sidebar-logic";

const history = {
  id: thread.id,
  projectId: thread.projectId,
  title: thread.title,
  titleFallback: null,
  providerId: thread.providerId,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: 10,
};

test("all archives stay settled despite attention or snooze, and restored live rows win", () => {
  const archived = { ...thread, isArchived: true, isUnread: true, latestAttentionAt: 999 };

  const result = partitionThreads({
    threads: [archived, { ...archived, id: "unrelated" }],
    snoozed: { one: { at: 1000, until: 2000 } },
    scopeProjectId: null,
    nowMs: 1000,
  });

  expect(result.settled).toHaveLength(2);
  expect(mergeSettledHistory([thread], [history])).toEqual([thread]);
});

test("archived history opens through navigation and Un-settle calls native restore", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
  window.localStorage.clear();
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  let dismissed = false;

  const slot = renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
      Original: () => null,
    },
    {
      sidebarThreads: { status: "ready", threads: [], projects: [] },
      rpc: {
        settled_list: () => ({
          archivedThreads: dismissed ? [] : [history],
        }),
        settled_set: (input) => {
          expect(input).toEqual({ threadId: "one", settled: false });
          dismissed = true;

          return null;
        },
        snoozed_list: () => ({ snoozed: {} }),
      },
    },
  );

  try {
    fireEvent.click(await slot.findByRole("button", { name: "Settled (1)" }));
    const row = await slot.findByRole("link", { name: "Reminder" });
    fireEvent.click(row);
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "one" });
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    fireEvent.contextMenu(row);
    expect(
      (await slot.findByRole("menuitem", { name: "Snooze" })).getAttribute("data-disabled"),
    ).not.toBeNull();
    expect(slot.queryByRole("menuitem", { name: "Archive" })).toBeNull();
    expect(slot.queryByRole("menuitem", { name: "Remove from Settled" })).toBeNull();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Un-settle" }));
    await slot.findByRole("button", { name: "Settle thread" });
    expect(slot.inspection.rpcCalls.some((call) => call.method === "settled_set")).toBe(true);
  } finally {
    slot.lifecycle.unmount();
    vi.unstubAllGlobals();
  }
});

test("settled history sorts by native archive time rather than later title edits", () => {
  const threads = mergeSettledHistory(
    [],
    [history, { ...history, id: "earlier", archivedAt: 5, updatedAt: 9999 }],
  );

  const result = partitionThreads({ threads, scopeProjectId: null, nowMs: 10000 });
  expect(result.settled.map((thread) => thread.id)).toEqual(["one", "earlier"]);
});

for (const outcome of ["success", "failure"] as const) {
  test(`Settle moves immediately, survives stale refreshes, and handles ${outcome}`, async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.clear();
    const app = await loadPluginApp(() => import("../../src/ui/app"));
    const liveThreads = [{ ...thread, isPinned: true }];
    let archived = false;
    let resolve!: (value: null) => void;
    let reject!: (error: Error) => void;

    const pending = new Promise<null>((yes, no) => {
      resolve = yes;
      reject = no;
    });

    const slot = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => {},
        searchQuery: "",
        Original: () => null,
      },
      {
        sidebarThreads: { status: "ready", threads: liveThreads, projects: [] },
        rpc: {
          settled_list: () => ({ archivedThreads: archived ? [history] : [] }),
          settled_set: () => pending,
          snoozed_list: () => ({ snoozed: {} }),
        },
      },
    );

    try {
      fireEvent.click(await slot.findByRole("button", { name: "Settle thread" }));
      expect(slot.queryByRole("link", { name: "Reminder" })).toBeNull();
      expect(slot.getByRole("button", { name: "Settled (1)" })).toBeTruthy();
      await slot.behavior.emitRealtime("settled-changed", {});
      expect(slot.queryByRole("link", { name: "Reminder" })).toBeNull();

      if (outcome === "failure") {
        await act(async () => reject(new Error("Archive failed")));
        await slot.findByRole("button", { name: "Settle thread" });
        expect(slot.queryByRole("button", { name: "Settled (1)" })).toBeNull();
      } else {
        await act(async () => resolve(null));
        // Even a successful RPC must not expose stale live sidebar data.
        expect(slot.queryByRole("link", { name: "Reminder" })).toBeNull();
        archived = true;
        liveThreads.splice(0);
        await slot.behavior.emitRealtime("settled-changed", {});
        expect(slot.getByRole("button", { name: "Settled (1)" })).toBeTruthy();
        // A later native restore must win after reconciliation.
        liveThreads.push({ ...thread, isPinned: true });
        archived = false;
        await slot.behavior.emitRealtime("settled-changed", {});
        await slot.findByRole("button", { name: "Settle thread" });
      }
    } finally {
      slot.lifecycle.unmount();
      warning.mockRestore();
      vi.unstubAllGlobals();
    }
  });
}

test("Un-settle responds immediately while a previous Settle finishes in order", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
  window.localStorage.clear();
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  let resolve!: (value: null) => void;

  const pending = new Promise<null>((yes) => {
    resolve = yes;
  });

  const mutations: boolean[] = [];

  const slot = renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
      Original: () => null,
    },
    {
      sidebarThreads: { status: "ready", threads: [thread], projects: [] },
      rpc: {
        settled_list: () => ({ archivedThreads: [] }),
        settled_set: async (input) => {
          const parsed = await settledContract.settled_set.input["~standard"].validate(input);

          if (parsed.issues) throw new Error("Invalid settled mutation");
          const { settled } = parsed.value;
          mutations.push(settled);

          return settled ? pending : null;
        },
        snoozed_list: () => ({ snoozed: {} }),
      },
    },
  );

  try {
    fireEvent.click(await slot.findByRole("button", { name: "Settle thread" }));
    fireEvent.click(slot.getByRole("button", { name: "Settled (1)" }));
    fireEvent.click(await slot.findByRole("button", { name: "Un-settle thread" }));
    expect(slot.getByRole("button", { name: "Settle thread" })).toBeTruthy();
    expect(mutations).toEqual([true]);
    await act(async () => resolve(null));
    expect(mutations).toEqual([true, false]);
    expect(slot.getByRole("button", { name: "Settle thread" })).toBeTruthy();
  } finally {
    slot.lifecycle.unmount();
    vi.unstubAllGlobals();
  }
});
