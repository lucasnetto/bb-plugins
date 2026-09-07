// @vitest-environment jsdom
import { test, expect } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
const workspace = {
  root: "/work",
  hostId: "h1",
  projectId: "p1",
  name: "Company",
};
const repos = [{ name: "api", branch: "main", remote: "org/api", changes: 1, error: null }];
const pr = {
  number: 42,
  title: "Fix validation",
  url: "https://github.com/org/api/pull/42",
  headRefName: "fix",
  baseRefName: "main",
  author: "alice",
  isDraft: false,
};

test("repository navigation loads the selected change and preserves its explicit file target", async () => {
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  const slot = renderSlot(
    app.navPanels.find((p) => p.id === "repos")!,
    { subPath: "" },
    {
      rpc: {
        workspace: () => workspace,
        discover: () => repos,
        changes: () => [{ path: "file.ts", oldPath: null, index: " ", worktree: "M" }],
        detail: () => ({
          path: "file.ts",
          patch: "@@ -1 +1 @@\n-old\n+new\n",
          content: null,
          notice: null,
        }),
      },
    },
  );
  try {
    fireEvent.click(await slot.findByRole("button", { name: /api main/ }));
    fireEvent.click(await slot.findByRole("button", { name: /file\.ts/ }));
    const link = await slot.findByRole("link", { name: "Open file" });
    expect(link.getAttribute("href")).toBeTruthy();
    await waitFor(() =>
      expect(JSON.stringify(slot.inspection.rpcCalls)).toContain('"path":"file.ts"'),
    );
  } finally {
    slot.lifecycle.unmount();
  }
});
test("repository PR tab loads file patches and navigates to the launched review thread", async () => {
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  const slot = renderSlot(
    app.navPanels.find((p) => p.id === "repos")!,
    { subPath: "" },
    {
      rpc: {
        workspace: () => workspace,
        discover: () => repos,
        changes: () => [],
        prs: () => [pr],
        prFiles: () => [
          {
            path: "file.ts",
            status: "modified",
            patch: "@@ -1 +1 @@\n-old\n+new\n",
          },
        ],
        review: () => ({ threadId: "review-42" }),
      },
    },
  );
  try {
    expect(app.navPanels.map((panel) => panel.id)).toEqual(["repos"]);
    fireEvent.click(await slot.findByRole("button", { name: /api main/ }));
    fireEvent.mouseDown(await slot.findByRole("tab", { name: "Pull requests" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await slot.findByRole("button", { name: /Fix validation/ }));
    await slot.findByRole("button", { name: "file.ts" });
    fireEvent.click(await slot.findByRole("button", { name: "Start review" }));
    await waitFor(() =>
      expect(JSON.stringify(slot.inspection.navigateCalls)).toContain("review-42"),
    );
    expect(JSON.stringify(slot.inspection.rpcCalls)).toContain('"number":42');
  } finally {
    slot.lifecycle.unmount();
  }
});

test("linked PR picker opens the selected PR in its thread panel and unlink preserves the other PR", async () => {
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  let links = [42, 43].map((number) => ({
    ...pr,
    number,
    url: `https://github.com/org/api/pull/${number}`,
    repository: "org/api",
    state: "OPEN",
    reason: "manual",
    linkedAt: number,
  }));
  const slot = renderSlot(
    app.threadPanelActions.find((p) => p.id === "linked-prs")!,
    { threadId: "t1", params: null },
    {
      context: { threadId: "t1" },
      rpc: {
        linkedList: () => links,
        linkedUnlink: (input) => {
          const { url } = input as { url: string };
          links = links.filter((p) => p.url !== url);
          return { removed: true };
        },
      },
    },
  );
  try {
    const reviews = await slot.findAllByRole("button", { name: "Review" });
    fireEvent.click(reviews[1]);
    expect(JSON.stringify(slot.inspection.navigateCalls)).toContain(
      "https://github.com/org/api/pull/43",
    );
    fireEvent.click(slot.getAllByRole("button", { name: "Unlink" })[0]);
    await waitFor(() => expect(slot.getAllByRole("button", { name: "Review" })).toHaveLength(1));
    expect(links[0].number).toBe(43);
  } finally {
    slot.lifecycle.unmount();
  }
});
