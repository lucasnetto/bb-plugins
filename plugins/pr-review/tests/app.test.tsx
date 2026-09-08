// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

it("defaults to authored PRs, switches views, and opens a review draft without creating a thread", async () => {
  sessionStorage.clear();
  const app = await loadPluginApp(() => import("../app"));
  const views: string[] = [];
  const openedUrls: string[] = [];
  const url = "https://github.com/acme/api/pull/42";
  const slot = renderSlot(
    app.navPanels.find((p) => p.id === "pull-requests")!,
    { subPath: "" },
    {
      openUrl: (url) => {
        openedUrls.push(url);
        return true;
      },
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
      },
    },
  );
  try {
    await slot.findByText("Fix API");
    fireEvent.click(slot.getByRole("link", { name: "Fix API" }));
    expect(openedUrls).toEqual([url]);
    expect(slot.inspection.rpcCalls.some((call) => call.method === "review")).toBe(false);
    expect(sessionStorage.getItem("bb:pr-review:open-review:t1")).toBeNull();
    expect(views).toEqual(["authored"]);
    const stateFilter = slot.getByRole("combobox", { name: "Pull request state" });
    expect((stateFilter as HTMLSelectElement).value).toBe("all");
    fireEvent.change(stateFilter, { target: { value: "ready" } });
    await waitFor(() => expect(views).toEqual(["authored", "authored"]));
    expect(JSON.stringify(slot.inspection.rpcCalls)).toContain('"state":"ready"');
    fireEvent.change(slot.getByRole("combobox", { name: "Pull request state" }), {
      target: { value: "all" },
    });
    await waitFor(() => expect(views).toHaveLength(3));
    await slot.findByText("Fix API");
    expect(slot.getByText("Draft")).toBeTruthy();
    fireEvent.mouseDown(slot.getByRole("tab", { name: "Review requested" }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() => expect(views).toEqual(["authored", "authored", "authored", "reviewing"]));
    await slot.findByText("Fix API");
    fireEvent.click(slot.getByRole("button", { name: "Review acme/api #42" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "review",
      options: { subPath: "acme/api/42" },
    });
    expect(slot.inspection.navigateCalls.some((call) => call.method === "toThread")).toBe(false);
    expect(slot.inspection.rpcCalls.some((call) => call.method === "review")).toBe(false);
    expect(sessionStorage.getItem("bb:pr-review:open-review:t1")).toBeNull();
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
      app.navPanels.find((p) => p.id === "pull-requests")!,
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
