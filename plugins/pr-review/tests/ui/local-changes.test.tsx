// @vitest-environment jsdom
import { expect, it, vi } from "vite-plus/test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  localRpcContract,
  type Snapshot,
  type CheckoutDiff,
} from "../../src/local-changes/contract";

// jsdom has no scrolling implementation; actual navigation is verified in the live panel.
HTMLElement.prototype.scrollTo = function () {};

// jsdom has no layout observer; the resizable sidebar is checked in the live browser.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

function treeFile(path: string) {
  for (const tree of document.querySelectorAll("file-tree-container")) {
    const row = [...(tree.shadowRoot?.querySelectorAll("[data-item-path]") ?? [])].find(
      (item) => item.getAttribute("data-item-path") === path,
    );

    if (row) return row;
  }

  return null;
}

async function findTreeFile(path: string) {
  return waitFor(() => {
    const row = treeFile(path);

    if (!row) throw new Error(`Tree file not found: ${path}`);

    return row;
  });
}

it("defaults to the current worktree, can browse others, and refreshes newly created worktrees", async () => {
  const app = await loadPluginApp(() => import("../../app"));

  const snapshot: Snapshot = {
    root: "/worktree",
    warnings: [],
    checkouts: [
      {
        repository: "service",
        path: "/worktree",
        branch: "feature",
        current: true,
        error: null,
        changes: [
          { path: "src/current.txt", area: "staged", status: "M" },
          { path: "src/current.txt", area: "unstaged", status: "M" },
        ],
      },
      {
        repository: "service",
        path: "/main",
        branch: "main",
        current: false,
        error: null,
        changes: [{ path: "src/other.txt", area: "untracked", status: "?" }],
      },
    ],
  };

  const slot = renderSlot(
    app.threadPanelActions.find((entry) => entry.id === "local-changes")!,
    { threadId: "thread", params: null },
    {
      rpc: {
        localSnapshot: () => structuredClone(snapshot),
        localCheckoutDiff: (input) => {
          const { checkout } = localRpcContract.localCheckoutDiff.input.parse(input);

          return snapshot.checkouts
            .find((entry) => entry.path === checkout)!
            .changes.map((change) => ({ path: change.path, patch: "", notice: "Preview ready" }));
        },
      },
    },
  );

  try {
    const currentCheckout = (await slot.findAllByText("/worktree"))
      .find((node) => node.closest("details"))
      ?.closest("details");

    expect(currentCheckout?.open).toBe(false);
    expect(slot.getByText("Select a workspace to view changes.")).toBeTruthy();
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "localCheckoutDiff"),
    ).toHaveLength(0);
    fireEvent.click(currentCheckout!.querySelector("summary")!);
    await findTreeFile("src/current.txt");
    expect(currentCheckout?.querySelectorAll("file-tree-container")).toHaveLength(1);
    expect(slot.queryByText("Unstaged")).toBeNull();
    expect(slot.queryByText("Untracked")).toBeNull();
    expect(slot.queryByText("Staged")).toBeNull();
    expect(treeFile("src/other.txt")).toBeNull();
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.some((call) => call.method === "localCheckoutDiff")).toBe(
        true,
      ),
    );
    fireEvent.click(slot.getByRole("button", { name: "Current checkout" }));
    const otherCheckout = (await slot.findByText("/main")).closest("details");
    expect(otherCheckout?.open).toBe(false);
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "localCheckoutDiff"),
    ).toHaveLength(1);
    fireEvent.click(otherCheckout!.querySelector("summary")!);
    expect(currentCheckout?.open).toBe(false);
    expect(otherCheckout?.open).toBe(true);
    fireEvent.click(await findTreeFile("src/other.txt"));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "localCheckoutDiff",
        input: { threadId: "thread", checkout: "/main" },
      }),
    );
    await waitFor(() =>
      expect(treeFile("src/current.txt")?.getAttribute("aria-selected")).toBe("false"),
    );
    expect(treeFile("src/other.txt")?.getAttribute("data-item-git-status")).toBe("untracked");
    fireEvent.click(currentCheckout!.querySelector("summary")!);
    expect(otherCheckout?.open).toBe(false);
    await slot.findByRole("button", { name: "Refresh" });
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "localSnapshot")).toHaveLength(
      1,
    );

    const currentGroup = within(
      slot.getByRole("region", { name: "service · feature · /worktree" }),
    );

    fireEvent.click(currentGroup.getByRole("button", { name: "Collapse all folders" }));
    await waitFor(() => expect(treeFile("src/current.txt")).toBeNull());
    snapshot.checkouts.push({
      repository: "service",
      path: "/new-worktree",
      branch: "new-branch",
      current: false,
      error: null,
      changes: [{ path: "new.txt", status: "M", area: "staged" }],
    });
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    const newCheckout = (await slot.findByText("/new-worktree")).closest("details");
    expect(newCheckout?.open).toBe(false);
    expect(currentCheckout?.open).toBe(true);
    fireEvent.click(newCheckout!.querySelector("summary")!);
    expect(currentCheckout?.open).toBe(false);
    await findTreeFile("new.txt");
    const sidebar = slot.getByRole("complementary", { name: "Files sidebar" });
    expect(
      [...sidebar.querySelectorAll("file-tree-container")].some((tree) =>
        tree.shadowRoot?.contains(treeFile("new.txt")),
      ),
    ).toBe(true);
    await slot.findByRole("button", { name: "Refresh" });
    snapshot.checkouts[2].changes = [];
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(treeFile("new.txt")).toBeNull());
    expect(slot.queryByText("/new-worktree")).toBeNull();
    expect(slot.getByText("Select a workspace to view changes.")).toBeTruthy();
    expect(treeFile("src/current.txt")).toBeNull();
    fireEvent.click(currentCheckout!.querySelector("summary")!);
    await findTreeFile("src/current.txt");
  } finally {
    slot.lifecycle.unmount();
  }
});

it("shows cached diffs while switching, ignores late responses, and clears the viewer on collapse", async () => {
  const app = await loadPluginApp(() => import("../../app"));
  const preview = (notice: string): CheckoutDiff => [{ path: "file.txt", patch: "", notice }];
  let delayAlpha = false;
  let resolveAlpha!: (files: CheckoutDiff) => void;
  let resolveBeta!: (files: CheckoutDiff) => void;

  const slot = renderSlot(
    app.threadPanelActions.find((entry) => entry.id === "local-changes")!,
    { threadId: "directory-thread", params: null },
    {
      rpc: {
        localSnapshot: () => ({
          root: "/repos",
          warnings: [],
          checkouts: ["alpha", "beta"].map((repository) => ({
            repository,
            path: `/${repository}`,
            branch: "main",
            current: false,
            error: null,
            changes: [{ path: "file.txt", status: "M", area: "unstaged" }],
          })),
        }),
        localCheckoutDiff: (input) => {
          const { checkout } = localRpcContract.localCheckoutDiff.input.parse(input);

          if (checkout === "/alpha")
            return delayAlpha
              ? new Promise<CheckoutDiff>((resolve) => {
                  resolveAlpha = resolve;
                })
              : preview("Cached alpha diff");

          return new Promise<CheckoutDiff>((resolve) => {
            resolveBeta = resolve;
          });
        },
      },
    },
  );

  const rendered = () =>
    [...document.querySelectorAll("diffs-container")]
      .map((container) => container.shadowRoot?.textContent ?? "")
      .join("\n");

  try {
    const alpha = (await slot.findByText("/alpha")).closest("details")!;
    const beta = (await slot.findByText("/beta")).closest("details")!;
    fireEvent.click(alpha.querySelector("summary")!);
    await waitFor(() => expect(rendered()).toContain("Cached alpha diff"));
    fireEvent.click(beta.querySelector("summary")!);
    await waitFor(() => expect(resolveBeta).toBeTypeOf("function"));
    expect(alpha.open).toBe(false);
    expect(rendered()).not.toContain("Cached alpha diff");
    delayAlpha = true;
    fireEvent.click(alpha.querySelector("summary")!);
    await waitFor(() => expect(resolveAlpha).toBeTypeOf("function"));
    await waitFor(() => expect(rendered()).toContain("Cached alpha diff"));
    await act(async () => resolveBeta(preview("Late beta diff")));
    expect(rendered()).not.toContain("Late beta diff");
    expect(alpha.open).toBe(true);
    expect(beta.open).toBe(false);
    fireEvent.click(alpha.querySelector("summary")!);
    await slot.findByText("Select a workspace to view changes.");
    await act(async () => resolveAlpha(preview("Late alpha diff")));
    expect(document.querySelector(".diff-render-surface")).toBeNull();
    expect(alpha.open).toBe(false);
  } finally {
    slot.lifecycle.unmount();
  }
});

it("shows all repositories for a parent directory and surfaces scan failures", async () => {
  const app = await loadPluginApp(() => import("../../app"));

  const slot = renderSlot(
    app.threadPanelActions.find((entry) => entry.id === "local-changes")!,
    { threadId: "directory-thread", params: null },
    {
      rpc: {
        localSnapshot: () => ({
          root: "/180seg",
          warnings: ["A worktree is unavailable"],
          checkouts: [
            {
              repository: "api",
              path: "/180seg/api",
              branch: "main",
              current: false,
              changes: [],
              error: "Permission denied",
            },
            {
              repository: "web",
              path: "/180seg/web",
              branch: "main",
              current: false,
              changes: [],
              error: null,
            },
          ],
        }),
      },
    },
  );

  try {
    await slot.findByText("No local changes in the selected checkouts.");
    expect(slot.queryByText("api")).toBeNull();
    expect(slot.queryByText("web")).toBeNull();
    expect(slot.queryByRole("button", { name: "Current checkout" })).toBeNull();
    expect(slot.getByText("/180seg/api: Permission denied")).toBeTruthy();
    await slot.findByText("A worktree is unavailable");
  } finally {
    slot.lifecycle.unmount();
  }
});
