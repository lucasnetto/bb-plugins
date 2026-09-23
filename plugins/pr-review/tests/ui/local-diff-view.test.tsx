// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { act } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { useLocalDiffView as LocalView } from "../../src/local-changes/useLocalDiffView";
import type { Checkout } from "../../src/local-changes/contract";

it("keeps every diff and stable identities when revealing or collapsing one file", async () => {
  installTestPluginRuntime();

  const { useLocalDiffView, localFileId } =
    await import("../../src/local-changes/useLocalDiffView");

  const checkouts: Checkout[] = ["/repo", "/worktree"].map((path) => ({
    repository: "repo",
    path,
    branch: path,
    current: false,
    error: null,
    changes: [{ path: "file.txt", area: "unstaged", status: "M" }],
  }));

  const patch =
    "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n";

  const previews = new Map(
    checkouts.map((checkout) => [checkout.path, [{ path: "file.txt", patch, notice: null }]]),
  );

  let current!: ReturnType<typeof LocalView>;

  function Probe() {
    current = useLocalDiffView(checkouts, previews);

    return null;
  }

  const slot = renderSlot({ component: Probe }, {});

  try {
    expect(current.items).toHaveLength(2);
    expect(current.items.every((item) => item.type === "diff")).toBe(true);
    const ids = current.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
    const viewer = current.viewer;
    act(() => current.reveal("/worktree", "file.txt"));
    expect(current.active).toMatchObject({ checkout: "/worktree", path: "file.txt" });
    expect(current.items.map((item) => item.id)).toEqual(ids);
    expect(current.viewer).toBe(viewer);
    act(() => current.display.toggleAllFiles());
    expect(current.items.every((item) => item.collapsed)).toBe(true);
    act(() => current.reveal("/repo", "file.txt"));
    expect(
      current.items.find((item) => item.id === localFileId("/repo", "file.txt"))?.collapsed,
    ).toBe(false);
    expect(
      current.items.find((item) => item.id === localFileId("/worktree", "file.txt"))?.collapsed,
    ).toBe(true);
    expect(current.items).toHaveLength(2);
  } finally {
    slot.lifecycle.unmount();
  }
});
