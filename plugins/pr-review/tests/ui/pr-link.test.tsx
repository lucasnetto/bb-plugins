// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { overview } from "../workspace-fixture";
import { invalidateWorkspace } from "../../src/ui/workspace/workspace-cache";

installTestPluginRuntime();

const { LinkedPrsPanel } = await import("../../src/ui/linked-prs");

test("viewing stays unlinked until Link PR is clicked; Unlink PR keeps the panel open", async () => {
  invalidateWorkspace();
  let linked = false;
  let writes = 0;
  let failUnlink = false;
  const row = { ...overview, reason: "manual", linkedAt: 1 };

  const slot = renderSlot(
    { component: LinkedPrsPanel },
    { threadId: "link-toggle", params: { url: overview.url } },
    {
      rpc: {
        linkedList: () => (linked ? [row] : []),
        linkedLink: (input) => {
          expect(input).toEqual({ threadId: "link-toggle", url: overview.url, reason: "manual" });
          writes++;
          linked = true;

          return row;
        },
        linkedUnlink: (input) => {
          expect(input).toEqual({ threadId: "link-toggle", url: overview.url });

          if (failUnlink) throw new Error("Unlink failed");
          writes++;
          linked = false;

          return { removed: true };
        },
        prOverview: () => overview,
        prStack: () => null,
        prTimeline: () => ({ entries: [], nextPage: null, truncated: false }),
      },
    },
  );

  try {
    const heading = await slot.findByRole("heading", { name: "Fix API" });
    const link = slot.getByRole("button", { name: "Link PR" });
    await waitFor(() => expect(link.hasAttribute("disabled")).toBe(false));
    expect(writes).toBe(0);
    const checkout = slot.getByRole("button", { name: "Check out" });
    expect(link.compareDocumentPosition(checkout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(link);
    const unlink = await slot.findByRole("button", { name: "Unlink PR" });
    expect(writes).toBe(1);
    failUnlink = true;
    fireEvent.click(unlink);
    expect((await slot.findByRole("alert")).textContent).toContain("Unlink failed");
    expect(slot.getByRole("button", { name: "Unlink PR" })).toBeTruthy();
    failUnlink = false;
    fireEvent.click(slot.getByRole("button", { name: "Unlink PR" }));
    await slot.findByRole("button", { name: "Link PR" });
    expect(writes).toBe(2);
    expect(slot.getByRole("heading", { name: "Fix API" })).toBe(heading);
    expect(slot.inspection.navigateCalls).toEqual([]);
  } finally {
    slot.lifecycle.unmount();
  }
});
