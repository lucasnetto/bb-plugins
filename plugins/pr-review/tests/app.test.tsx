// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

it("defaults to authored PRs, switches views, and hands a review to Multirepo", async () => {
  sessionStorage.clear();
  const app = await loadPluginApp(() => import("../app"));
  const views: string[] = [];
  const url = "https://github.com/acme/api/pull/42";
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      rpc: {
        list: (input) => {
          const { view } = input as { view: string };
          views.push(view);
          return {
            viewer: "lucas",
            rows: [
              {
                url,
                repository: "acme/api",
                number: 42,
                title: "Fix API",
                author: "lucas",
                isDraft: true,
                updatedAt: "2026-09-07T12:00:00Z",
              },
            ],
            total: 1,
            nextPage: null,
            incomplete: false,
          };
        },
        review: () => ({ threadId: "t1", warning: null }),
      },
    },
  );
  try {
    await slot.findByText("Fix API");
    expect(views).toEqual(["authored"]);
    expect(slot.getByText("Draft")).toBeTruthy();
    fireEvent.mouseDown(slot.getByRole("tab", { name: "Review requested" }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() => expect(views).toEqual(["authored", "reviewing"]));
    await slot.findByText("Fix API");
    fireEvent.click(slot.getByRole("button", { name: "Review acme/api #42" }));
    await waitFor(() => expect(slot.inspection.navigateCalls.length).toBe(1));
    expect(sessionStorage.getItem("bb:multirepo:open-review:t1")).toBe(url);
  } finally {
    slot.lifecycle.unmount();
  }
});
