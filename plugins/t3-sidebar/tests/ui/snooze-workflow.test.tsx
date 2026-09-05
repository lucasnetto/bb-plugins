// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { thread } from "./thread-fixture";
import { snoozeContract } from "../../src/shared/snooze-contract";
import type { SnoozedMap } from "../../src/shared/snooze-contract";

test("context menu snoozes a thread; shelf can wake it without navigating", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
  window.localStorage.clear();
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  let snoozed: SnoozedMap = {};
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
      settings: { autoSettleAfter: "Never" },
      rpc: {
        settled_list: () => ({ settled: {} }),
        snoozed_list: () => ({ snoozed }),
        snoozed_set: async (input) => {
          const result = await snoozeContract.snoozed_set.input["~standard"].validate(input);
          if (result.issues) throw new Error("Invalid snooze input");
          const { threadId, until } = result.value;
          snoozed = { ...snoozed, [threadId]: { at: Date.now(), until: until ?? Date.now() } };
          return { snoozed };
        },
      },
    },
  );
  try {
    fireEvent.contextMenu(await slot.findByRole("link", { name: "Reminder" }));
    fireEvent.keyDown(await slot.findByText("Snooze", { selector: '[role="menuitem"]' }), {
      key: "ArrowRight",
    });
    fireEvent.click(await slot.findByRole("menuitem", { name: /For 1 hour/ }));
    const shelf = await slot.findByRole("button", { name: "Snoozed (1)" });
    expect(slot.queryByRole("link", { name: "Reminder" })).toBeNull();
    fireEvent.click(shelf);
    fireEvent.click(await slot.findByRole("button", { name: "Wake now" }));
    await waitFor(() => expect(slot.queryByRole("button", { name: /^Snoozed/ })).toBeNull());
    expect(await slot.findByRole("link", { name: "Reminder" })).toBeTruthy();
    fireEvent.keyDown(await slot.findByRole("button", { name: "Snooze thread" }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitem", { name: /For 3 hours/ }));
    await slot.findByRole("button", { name: "Wake now" });
    expect(slot.inspection.sidebarActionCalls).toHaveLength(0);
  } finally {
    slot.lifecycle.unmount();
    vi.unstubAllGlobals();
  }
});
