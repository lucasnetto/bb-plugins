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
        savedList: (input) => {
          const { view } = input as { view: string };

          return {
            scope: view,
            view,
            fetchedAt: 1,
            pageCount: 1,
            error: null,
            result: {
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
            },
          };
        },
        refreshList: (input) => {
          views.push((input as { view: string }).view);
          return null;
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

it("shows SQLite rows on every mount while refresh is pending and rereads realtime changes", async () => {
  const app = await loadPluginApp(() => import("../app"));
  let title = "Saved PR";
  let refreshes = 0;
  let release!: () => void;
  const pending = new Promise<null>((resolve) => {
    release = () => resolve(null);
  });
  const mount = () =>
    renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          savedList: () => ({
            scope: "s",
            view: "authored",
            fetchedAt: 1,
            pageCount: 1,
            error: null,
            result: {
              viewer: "lucas",
              rows: [
                {
                  url: "https://github.com/acme/api/pull/42",
                  repository: "acme/api",
                  number: 42,
                  title,
                  author: "lucas",
                  isDraft: false,
                  updatedAt: "2026-09-07",
                },
              ],
              total: 1,
              nextPage: null,
              incomplete: false,
            },
          }),
          refreshList: () => {
            refreshes++;
            return pending;
          },
        },
      },
    );
  let slot = mount();
  try {
    await slot.findByText("Saved PR");
    expect(slot.queryByText("Loading pull requests…")).toBeNull();
    slot.lifecycle.unmount();
    slot = mount();
    await slot.findByText("Saved PR");
    expect(slot.queryByText("Loading pull requests…")).toBeNull();
    expect(refreshes).toBe(2);
    title = "Realtime update";
    await slot.behavior.emitRealtime("pr-list-changed", { scope: "s", view: "authored" });
    await slot.findByText("Realtime update");
    expect(refreshes).toBe(2);
    release();
    await waitFor(() =>
      expect(slot.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await slot.findByText("Realtime update");
    expect(slot.queryByText("Loading pull requests…")).toBeNull();
  } finally {
    release();
    slot.lifecycle.unmount();
  }
});
