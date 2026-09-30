// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
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

test("Settle delegates to BB and waits for confirmation before moving the card", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
  window.localStorage.clear();
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  const liveThreads = [thread];
  let archived = false;
  const slot = renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
    },
    {
      sidebarThreads: { status: "ready", threads: liveThreads, projects: [] },
      rpc: {
        settled_list: () => ({ archivedThreads: archived ? [history] : [] }),
        snoozed_list: () => ({ snoozed: {} }),
      },
    },
  );
  try {
    fireEvent.click(await slot.findByRole("button", { name: "Settle thread" }));
    expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "archive", threadId: "one" }]);
    expect(slot.inspection.rpcCalls.some((call) => call.method === "settled_set")).toBe(false);
    expect(slot.getByRole("link", { name: "Reminder" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Settled (1)" })).toBeNull();
    // Canceling the host dialog emits no archive event and must leave the row visible.
    await slot.behavior.emitRealtime("settled-changed", {});
    expect(slot.getByRole("link", { name: "Reminder" })).toBeTruthy();
    // A confirmed host archive arrives through the native sidebar and realtime data.
    archived = true;
    liveThreads.splice(0);
    await slot.behavior.emitRealtime("settled-changed", {});
    await slot.findByRole("button", { name: "Settled (1)" });
    expect(slot.queryByRole("link", { name: "Reminder" })).toBeNull();
  } finally {
    slot.lifecycle.unmount();
    vi.unstubAllGlobals();
  }
});
