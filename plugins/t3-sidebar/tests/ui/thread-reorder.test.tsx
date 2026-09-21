// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { thread } from "./thread-fixture";

const rows = [
  { ...thread, id: "a", title: "Alpha", createdAt: 30, host: { id: "one", name: "One" } },
  { ...thread, id: "b", title: "Beta", createdAt: 20, host: { id: "two", name: "Two" } },
  { ...thread, id: "c", title: "Charlie", createdAt: 10, host: { id: "one", name: "One" } },
  { ...thread, id: "p", title: "Pin one", isPinned: true },
  { ...thread, id: "q", title: "Pin two", isPinned: true },
];

const props = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate: vi.fn(),
  searchQuery: "",
  Original: () => null,
};

let unmount: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
  // jsdom does not implement PointerEvent's coordinates/identity.
  vi.stubGlobal("PointerEvent", MouseEvent);
});

afterEach(() => {
  unmount?.();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(groupByMachine = false) {
  const app = await loadPluginApp(() => import("../../src/ui/app"));

  const slot = renderSlot(app.threadLists[0]!, props, {
    settings: { groupByMachine },
    sidebarThreads: { status: "ready", threads: rows, projects: [] },
    rpc: { settled_list: () => ({ archivedThreads: [] }), snoozed_list: () => ({ snoozed: {} }) },
  });

  unmount = () => slot.lifecycle.unmount();
  await slot.findByRole("link", { name: "Alpha" });

  const root = slot
    .getByRole("link", { name: "Alpha" })
    .closest("[data-thread-item]")!
    .closest("ul")!;

  const outer = root.parentElement!.closest("ul") ?? root;

  const rect = (top: number, height: number) => ({
    x: 0,
    y: top,
    left: 0,
    right: 250,
    top,
    bottom: top + height,
    width: 250,
    height,
    toJSON() {},
  });

  vi.spyOn(outer, "getBoundingClientRect").mockReturnValue(rect(0, 500));
  outer
    .querySelectorAll<HTMLElement>("[data-reorder-id]")
    .forEach((row, i) => vi.spyOn(row, "getBoundingClientRect").mockReturnValue(rect(i * 60, 60)));

  return {
    slot,
    outer,
    ids: () =>
      Array.from(outer.querySelectorAll<HTMLElement>("[data-reorder-id]")).map(
        (el) => el.dataset.reorderId,
      ),
  };
}

test("whole-card drag persists ordering without opening the thread", async () => {
  const { slot, ids, outer } = await mount();
  const source = slot.getByRole("link", { name: "Charlie" });
  fireEvent.pointerDown(source, { button: 0, clientX: 100, clientY: 270 });
  fireEvent.pointerMove(window, { clientX: 100, clientY: 125 });
  expect(outer.querySelector('[data-reorder-edge="before"]')).toBeTruthy();
  fireEvent.pointerUp(window, { clientX: 100, clientY: 125 });
  expect(source.isConnected).toBe(true);
  fireEvent.click(source);
  expect(ids()).toEqual(["p", "q", "c", "a", "b"]);
  // The SDK harness records split pointer-down as an open; release/click adds none.
  expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "open", threadId: "c" }]);
  unmount?.();
  const restored = await mount();
  expect(restored.ids()).toEqual(["p", "q", "c", "a", "b"]);
});

test.each(["escape", "outside", "cancel", "small", "other-section"])(
  "%s drag does not reorder",
  async (kind) => {
    const { slot, ids } = await mount();
    fireEvent.pointerDown(slot.getByRole("link", { name: "Charlie" }), {
      button: 0,
      clientX: 100,
      clientY: 270,
    });
    fireEvent.pointerMove(window, { clientX: 100, clientY: kind === "small" ? 272 : 125 });

    if (kind === "escape") fireEvent.keyDown(window, { key: "Escape" });

    if (kind === "outside") fireEvent.pointerMove(window, { clientX: 400, clientY: 125 });

    if (kind === "cancel") fireEvent.pointerCancel(window);

    if (kind === "other-section") fireEvent.pointerMove(window, { clientX: 100, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 125 });
    expect(ids()).toEqual(["p", "q", "a", "b", "c"]);
  },
);

test("keyboard ordering stays within machine groups and pinned section", async () => {
  const { slot, ids } = await mount(true);
  fireEvent.keyDown(slot.getByRole("link", { name: "Charlie" }), { altKey: true, key: "ArrowUp" });
  expect(ids()).toEqual(["p", "q", "c", "a", "b"]);
  fireEvent.keyDown(slot.getByRole("link", { name: "Pin two" }), { altKey: true, key: "ArrowUp" });
  expect(ids()).toEqual(["q", "p", "c", "a", "b"]);
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
});
