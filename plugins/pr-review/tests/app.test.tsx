// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

it("groups authored and requested reviews, filters locally, and selects a PR without starting a thread", async () => {
  sessionStorage.clear();
  const app = await loadPluginApp(() => import("../app"));
  expect(app.navPanels.map(({ path }) => path)).toEqual(["prs"]);
  const views: string[] = [];
  const url = "https://github.com/acme/api/pull/42";
  const slot = renderSlot(
    app.navPanels.find((p) => p.id === "pull-requests")!,
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
                  url: view === "authored" ? url : "https://github.com/acme/api/pull/43",
                  repository: "acme/api",
                  number: view === "authored" ? 42 : 43,
                  title: view === "authored" ? "Fix API" : "Review worker",
                  author: "lucas",
                  isDraft: view === "authored",
                  updatedAt: "2026-09-07T12:00:00Z",
                  labels: view === "authored" ? [{ name: "bug", color: "ff0000" }] : [],
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
    await slot.findByText("Review worker");
    expect(slot.getByRole("heading", { name: "Authored" })).toBeTruthy();
    expect(slot.getByRole("heading", { name: "Review requested" })).toBeTruthy();
    expect(views.sort()).toEqual(["authored", "reviewing"]);
    fireEvent.change(slot.getByRole("searchbox"), { target: { value: "label:bug" } });
    await waitFor(() => expect(slot.queryByText("Review worker")).toBeNull());
    fireEvent.click(slot.getByRole("link", { name: /Fix API/ }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "prs",
      options: { subPath: "acme/api/42" },
    });
    expect(slot.inspection.navigateCalls.some((call) => call.method === "toThread")).toBe(false);
    expect(slot.inspection.rpcCalls.some((call) => call.method === "startReview")).toBe(false);
    fireEvent.keyDown(slot.getByRole("button", { name: "Filters" }), { key: "Enter" });
    fireEvent.keyDown(await slot.findByRole("menuitem", { name: /State/ }), { key: "ArrowRight" });
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Merged" }));
    await waitFor(() =>
      expect(JSON.stringify(slot.inspection.rpcCalls)).toContain('"state":"merged"'),
    );
    expect((slot.getByRole("searchbox") as HTMLInputElement).value).toBe("label:bug");
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
          savedList: (input) => ({
            scope: "s",
            view: "authored",
            fetchedAt: 1,
            pageCount: 1,
            error: null,
            result: {
              viewer: "lucas",
              rows:
                (input as { view: string }).view === "reviewing"
                  ? []
                  : [
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
    expect(refreshes).toBe(4);
    title = "Realtime update";
    await slot.behavior.emitRealtime("pr-list-changed", { scope: "s", view: "authored" });
    await slot.findByText("Realtime update");
    expect(refreshes).toBe(4);
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
