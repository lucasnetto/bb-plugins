// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { expect, test } from "vite-plus/test";

test("offers the recorded branch, creates a recovery, and opens it through BB navigation", async () => {
  const app = await loadPluginApp(() => import("../app"));

  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "source", params: null },
    {
      rpc: {
        preview: () => ({
          sourceThreadId: "source",
          projectId: "project",
          hostId: "host",
          environmentId: "old",
          title: "Work",
          branch: "feature",
          branches: ["feature", "main"],
          available: true,
          reason: null,
        }),
        recover: (input) => {
          expect(input).toEqual({ threadId: "source", branch: "feature" });

          return {
            threadId: "recovered",
            sourceThreadId: "source",
            branch: "feature",
            reused: false,
          };
        },
      },
    },
  );

  try {
    expect((await slot.findByLabelText("Branch")).getAttribute("value")).toBe("feature");
    fireEvent.click(slot.getByRole("button", { name: "Create recovery" }));
    fireEvent.click(await slot.findByRole("button", { name: "Open recovered thread" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "recovered",
    });
  } finally {
    slot.lifecycle.unmount();
  }
});

test("shows recovery failures and allows choosing an alternative branch", async () => {
  const app = await loadPluginApp(() => import("../app"));

  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "source", params: null },
    {
      rpc: {
        preview: () => ({
          sourceThreadId: "source",
          projectId: "project",
          hostId: "host",
          environmentId: "old",
          title: "Work",
          branch: "missing",
          branches: ["main"],
          available: false,
          reason: "Choose a surviving branch.",
        }),
        recover: (input) => {
          expect(input).toEqual({ threadId: "source", branch: "main" });
          throw new Error("Machine is offline");
        },
      },
    },
  );

  try {
    fireEvent.change(await slot.findByLabelText("Branch"), { target: { value: "main" } });
    fireEvent.click(slot.getByRole("button", { name: "Create recovery" }));
    expect((await slot.findByRole("alert")).textContent).toContain("Machine is offline");
    expect(slot.inspection.navigateCalls).toEqual([]);
  } finally {
    slot.lifecycle.unmount();
  }
});
