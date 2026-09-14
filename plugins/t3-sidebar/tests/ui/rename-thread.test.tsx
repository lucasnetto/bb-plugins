// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { renameContract } from "../../src/shared/rename-contract";
import { thread } from "./thread-fixture";

installTestPluginRuntime();

const { ThreadRow } = await import("../../src/ui/components/sidebar/ThreadRow");

const { TooltipProvider } = await import("../../src/ui/components/ui/tooltip");

const actions = {
  open() {},
  rename() {},
  setPinned() {},
  setRead() {},
  setSnoozed() {},
  setSettled() {},
  requestDelete() {},
};

function Menu({ section }: { section: "active" | "settled" }) {
  return (
    <TooltipProvider>
      <ThreadRow
        thread={thread}
        section={section}
        actions={actions}
        isActive={false}
        projectName={null}
        provider={null}
        timeAnchorMs={0}
        nowMs={0}
      />
    </TooltipProvider>
  );
}

afterEach(cleanup);

test.each(["active", "settled"] as const)(
  "%s row shows regeneration progress after the menu closes",
  async (section) => {
    let running = false;

    const slot = renderSlot<{ section: "active" | "settled" }, typeof renameContract>(
      { component: Menu },
      { section },
      {
        rpc: {
          rename_status: () => ({
            available: true,
            job: { status: running ? "running" : "idle", title: null, message: null },
          }),
          rename_start: () => {
            running = true;

            return { status: "running", title: null, message: null };
          },
        },
      },
    );

    try {
      fireEvent.contextMenu(slot.getByRole("link", { name: "Reminder" }));
      fireEvent.click(await slot.findByRole("menuitem", { name: "Regenerate title" }));
      expect(await slot.findByRole("status")).toHaveProperty("textContent", "Renaming…");
      expect(slot.queryByRole("menu")).toBeNull();
      fireEvent.contextMenu(slot.getByRole("link", { name: "Reminder" }));
      const item = await slot.findByRole("menuitem", { name: "Regenerating…" });
      expect(item.getAttribute("aria-disabled")).toBe("true");
      running = false;
      fireEvent.keyDown(item, { key: "Escape" });
      fireEvent.contextMenu(slot.getByRole("link", { name: "Reminder" }));
      await waitFor(() => expect(slot.queryByText("Renaming…")).toBeNull());
      expect(slot.inspection.rpcCalls.filter((call) => call.method === "rename_start")).toEqual([
        { method: "rename_start", input: { threadId: thread.id } },
      ]);
    } finally {
      slot.lifecycle.unmount();
    }
  },
);

test("keeps manual rename and hides regeneration without the optional plugin", async () => {
  const slot = renderSlot<{ section: "active" | "settled" }, typeof renameContract>(
    { component: Menu },
    { section: "active" },
    {
      rpc: {
        rename_status: () => ({ available: false, job: null }),
        rename_start: () => {
          throw new Error("Unavailable plugin must not be called");
        },
      },
    },
  );

  try {
    fireEvent.contextMenu(slot.getByRole("link", { name: "Reminder" }));
    expect(await slot.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(slot.queryByRole("menuitem", { name: "Regenerate title" })).toBeNull();
  } finally {
    slot.lifecycle.unmount();
  }
});
