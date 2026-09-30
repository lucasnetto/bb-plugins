// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { thread } from "./thread-fixture";
import { threadTree } from "../../src/ui/lib/thread-tree";

const parent = { ...thread, id: "parent", title: "Parent" };
const child = { ...thread, id: "child", title: "Child", parentThreadId: "parent" };
const grandchild = { ...thread, id: "grandchild", title: "Grandchild", parentThreadId: "child" };
const other = { ...thread, id: "other", title: "Other" };

test("orders descendants after parents and preserves sibling order", () => {
  expect(
    threadTree([grandchild, child, other, parent], []).map((r) => [r.thread.id, r.depth]),
  ).toEqual([
    ["other", 0],
    ["parent", 0],
    ["child", 1],
    ["grandchild", 2],
  ]);
});

test("collapse hides descendants; the active path is revealed", () => {
  const rows = [parent, child, grandchild, other];
  expect(threadTree(rows, ["parent"]).map((r) => r.thread.id)).toEqual(["parent", "other"]);
  expect(threadTree(rows, ["parent", "child"], "grandchild")).toHaveLength(4);
  expect(threadTree(rows, ["child"], "parent").map((r) => r.thread.id)).toEqual([
    "parent",
    "child",
    "other",
  ]);
});

test("missing parents and cycles never hide threads", () => {
  expect(threadTree([child], [parent.id])[0]?.depth).toBe(0);
  const cycle = [{ ...parent, parentThreadId: child.id }, child, grandchild];
  expect(new Set(threadTree(cycle, []).map((r) => r.thread.id)).size).toBe(3);
  expect(threadTree([{ ...parent, parentThreadId: parent.id }], [])).toHaveLength(1);
});

test("sidebar toggles children without navigation and reorders siblings only", async () => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  const onNavigate = vi.fn();
  const slot = renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate,
      searchQuery: "",
    },
    {
      sidebarThreads: {
        status: "ready",
        threads: [parent, child, grandchild, other],
        projects: [],
      },
      rpc: { settled_list: () => ({ archivedThreads: [] }), snoozed_list: () => ({ snoozed: {} }) },
    },
  );
  try {
    await slot.findByRole("link", { name: "Grandchild" });
    fireEvent.click(slot.getByRole("button", { name: "Collapse children of Parent" }));
    expect(slot.queryByRole("link", { name: "Child" })).toBeNull();
    expect(slot.queryByRole("link", { name: "Grandchild" })).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("t3-sidebar:collapsed-threads")!)).toEqual(["parent"]);
    fireEvent.click(slot.getByRole("button", { name: "Expand children of Parent" }));
    expect(slot.getByRole("link", { name: "Child" }).closest("li")?.dataset.threadDepth).toBe("1");
    fireEvent.keyDown(slot.getByRole("link", { name: "Parent" }), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(slot.getAllByRole("link").map((link) => link.getAttribute("aria-label"))).toEqual([
      "Other",
      "Parent",
      "Child",
      "Grandchild",
    ]);
  } finally {
    slot.lifecycle.unmount();
    vi.unstubAllGlobals();
  }
});

test("connectors continue past nested families only when an ancestor has more siblings", () => {
  const sibling = { ...child, id: "sibling" };
  const rows = threadTree([parent, child, grandchild, sibling, other], []);
  expect(
    rows.map(({ childCount, isLastChild, ancestorContinues, startsFamily }) => ({
      childCount,
      isLastChild,
      ancestorContinues,
      startsFamily,
    })),
  ).toEqual([
    { childCount: 2, isLastChild: false, ancestorContinues: [], startsFamily: false },
    { childCount: 1, isLastChild: false, ancestorContinues: [], startsFamily: false },
    { childCount: 0, isLastChild: true, ancestorContinues: [true], startsFamily: false },
    { childCount: 0, isLastChild: true, ancestorContinues: [], startsFamily: false },
    { childCount: 0, isLastChild: true, ancestorContinues: [], startsFamily: true },
  ]);
  expect(threadTree([parent, child, grandchild], ["parent"])[0]?.childCount).toBe(1);
});
