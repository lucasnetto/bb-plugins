// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { thread } from "./thread-fixture";
import { groupByMachine } from "../../src/ui/lib/machine-groups";
import { partitionThreads } from "../../src/ui/lib/sidebar-logic";

const host = { id: "host-a", name: "Laptop" };

const environment = {
  id: "env-a",
  name: "Checkout",
  branchName: "main",
  workspaceDisplayKind: "other" as const,
  path: null,
  isWorktree: null,
  providerId: null,
};

const threads = [
  { ...thread, id: "a", title: "First", environment, host },
  {
    ...thread,
    id: "b",
    title: "Second",
    projectId: "another-project",
    environment: { ...environment, id: "env-b" },
    host,
  },
  { ...thread, id: "c", title: "Other", host: { id: "host-b", name: "Laptop" } },
  { ...thread, id: "d", title: "Unassigned" },
  { ...thread, id: "p", title: "Pinned", host, isPinned: true },
  { ...thread, id: "s", title: "Sleeping", host },
];

const snoozed = { s: { at: Date.now(), until: Date.now() + 3_600_000 } };

const history = {
  id: "archive",
  projectId: thread.projectId,
  title: "History",
  titleFallback: null,
  providerId: thread.providerId,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: 10,
};

test("combines environments and projects by machine ID, not machine name", () => {
  const partition = partitionThreads({ threads, snoozed, scopeProjectId: null, nowMs: Date.now() });
  const groups = groupByMachine(partition.active);
  expect(groups).toHaveLength(3);
  expect(groups[0]?.threads.map((t) => t.id)).toEqual(["a", "b"]);
  expect(groups[1]?.threads.map((t) => t.id)).toEqual(["c"]);
  expect(groups[2]?.label).toBe("No machine");
  expect(
    groupByMachine(
      partitionThreads({ threads, snoozed, scopeProjectId: "another-project", nowMs: Date.now() })
        .active,
    )[0]?.threads.map((t) => t.id),
  ).toEqual(["b"]);
  expect(groupByMachine([])).toEqual([]);
});

test.each([false, true])("machine setting groups only active threads: %s", async (enabled) => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
  const app = await loadPluginApp(() => import("../../src/ui/app"));

  const slot = renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: "a",
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
    },
    {
      settings: enabled ? { groupByMachine: true } : {},
      sidebarThreads: { status: "ready", threads, projects: [], experimental_hosts: [host] },
      rpc: {
        settled_list: () => ({ archivedThreads: [history] }),
        snoozed_list: () => ({ snoozed }),
      },
    },
  );

  try {
    await slot.findByRole("link", { name: "First" });
    await slot.findByRole("button", { name: "Snoozed (1)" });

    if (enabled) {
      const groups = slot.getAllByRole("region", { name: "Laptop" });
      expect(groups).toHaveLength(2);
      expect(within(groups[0]!).getByRole("link", { name: "First" })).toBeTruthy();
      expect(within(groups[0]!).getByRole("link", { name: "Second" })).toBeTruthy();
      expect(within(groups[1]!).getByRole("link", { name: "Other" })).toBeTruthy();
      fireEvent.click(within(groups[0]!).getByRole("button", { name: "New thread on Laptop" }));
      expect(slot.inspection.sidebarActionCalls).toContainEqual({
        method: "openNewThread",
        options: { hostId: "host-a", projectId: undefined, focusPrompt: true },
      });
      expect(within(groups[1]!).queryByRole("button", { name: "New thread on Laptop" })).toBeNull();
    } else {
      expect(slot.queryAllByRole("region")).toHaveLength(0);
    }

    fireEvent.click(slot.getByRole("button", { name: "Snoozed (1)" }));
    fireEvent.click(await slot.findByRole("button", { name: "Settled (1)" }));

    for (const name of ["Pinned", "Sleeping", "History"]) {
      const row = await slot.findByRole("link", { name });
      expect(row.closest("section")).toBeNull();
    }

    expect(slot.queryAllByRole("region")).toHaveLength(enabled ? 3 : 0);
  } finally {
    slot.lifecycle.unmount();
    vi.unstubAllGlobals();
  }
});
