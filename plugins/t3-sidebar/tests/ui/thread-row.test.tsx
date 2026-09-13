// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ThreadRowProps } from "../../src/ui/components/sidebar/ThreadRow";
import { thread } from "./thread-fixture";

async function renderRow(threadOverrides: Partial<typeof thread> = {}) {
  installTestPluginRuntime();
  const { ThreadRow } = await import("../../src/ui/components/sidebar/ThreadRow");
  const { TooltipProvider } = await import("../../src/ui/components/ui/tooltip");

  const actions = {
    open: vi.fn(),
    setPinned: vi.fn(),
    setRead: vi.fn(),
    rename: vi.fn(),
    requestDelete: vi.fn(),
    setSnoozed: vi.fn(),
    setSettled: vi.fn(),
  };

  const slot = renderSlot(
    {
      component: (props: ThreadRowProps) => (
        <TooltipProvider>
          <ThreadRow {...props} />
        </TooltipProvider>
      ),
    },
    {
      thread: { ...thread, ...threadOverrides },
      section: "active",
      isActive: false,
      projectName: null,
      provider: null,
      timeAnchorMs: 0,
      nowMs: 0,
      actions,
    },
  );

  return { slot, actions };
}

test.each([false, true])("pending input stays prominent when unread is %s", async (isUnread) => {
  const { slot } = await renderRow({ hasPendingInteraction: true, indicator: "runtime", isUnread });

  try {
    expect(slot.getByRole("status").textContent).toBe("Input");
    const row = slot.getByRole("link", { name: "Reminder" });
    expect(row.classList.contains("opacity-70")).toBe(false);
    expect(row.classList.contains("text-muted-foreground/75")).toBe(false);
    expect(slot.queryByText("Working")).toBeNull();
    expect(slot.queryByText("Done")).toBeNull();
  } finally {
    slot.lifecycle.unmount();
  }
});

test.each(["Enter", "blur"])("F2 renames on %s without navigating the row", async (commit) => {
  const { slot, actions } = await renderRow();

  try {
    fireEvent.keyDown(slot.getByRole("link", { name: "Reminder" }), { key: "F2" });
    const input = slot.getByRole("textbox", { name: "Thread title" });

    if (!(input instanceof HTMLInputElement)) throw new Error("Expected thread title input");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Reminder".length);
    fireEvent.change(input, { target: { value: "  New title  " } });

    if (commit === "blur") fireEvent.blur(input);
    else fireEvent.keyDown(input, { key: "Enter" });
    expect(actions.rename).toHaveBeenCalledExactlyOnceWith("one", "New title");
    expect(actions.open).not.toHaveBeenCalled();
    expect(slot.queryByRole("textbox")).toBeNull();
  } finally {
    slot.lifecycle.unmount();
  }
});

test("double-click rename cancels with Escape without committing or navigating", async () => {
  const { slot, actions } = await renderRow();

  try {
    fireEvent.doubleClick(slot.getByRole("link", { name: "Reminder" }));
    const input = slot.getByRole("textbox", { name: "Thread title" });
    fireEvent.change(input, { target: { value: "Discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(slot.queryByRole("textbox")).toBeNull();
    expect(actions.rename).not.toHaveBeenCalled();
    expect(actions.open).not.toHaveBeenCalled();
  } finally {
    slot.lifecycle.unmount();
  }
});

test("context menu rename focuses the same inline editor", async () => {
  const { slot, actions } = await renderRow();

  try {
    fireEvent.contextMenu(slot.getByRole("link", { name: "Reminder" }));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Rename" }));
    const input = await slot.findByRole("textbox", { name: "Thread title" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "From menu" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(actions.rename).toHaveBeenCalledExactlyOnceWith("one", "From menu");
    expect(actions.open).not.toHaveBeenCalled();
  } finally {
    slot.lifecycle.unmount();
  }
});
