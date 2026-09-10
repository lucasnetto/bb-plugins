// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { overview, stack } from "../../workspace-fixture";

it("shows the exact native merge scope, waits for the result, and keeps the code view mounted across tabs", async () => {
  installTestPluginRuntime();
  sessionStorage.clear();
  const { PullRequestDetail } = await import("../../../src/ui/workspace/PullRequestDetail");
  let current = overview;
  let merges = 0;
  const slot = renderSlot(
    { component: PullRequestDetail },
    {
      threadId: null,
      url: overview.url,
      code: <textarea aria-label="Draft review" defaultValue="Keep this review" />,
    },
    {
      rpc: {
        prOverview: () => current,
        prStack: () => stack,
        prTimeline: () => ({ entries: [], nextPage: null, truncated: false }),
        prAction: (input) => {
          expect(input).toMatchObject({
            head: overview.headRefOid,
            base: "main",
            action: {
              kind: "merge",
              method: "squash",
              stack: {
                number: 7,
                base: "main",
                heads: stack.layers.map((layer) => ({
                  number: layer.number,
                  headRefOid: layer.headRefOid,
                })),
              },
            },
          });
          merges++;
          current = { ...overview, state: "MERGED" };
          return { message: "Stack merged.", pendingMergeId: null };
        },
      },
    },
  );
  try {
    await slot.findByRole("heading", { name: "Fix API" });
    expect(slot.queryByRole("textbox", { name: "Draft review" })).toBeNull();
    fireEvent.mouseDown(slot.getByRole("tab", { name: "Code" }), { button: 0, ctrlKey: false });
    const draft = slot.getByRole("textbox", { name: "Draft review" });
    fireEvent.change(draft, { target: { value: "Unsaved review" } });
    fireEvent.mouseDown(slot.getByRole("tab", { name: "Summary" }), { button: 0, ctrlKey: false });
    fireEvent.mouseDown(slot.getByRole("tab", { name: "Code" }), { button: 0, ctrlKey: false });
    expect(slot.getByRole("textbox", { name: "Draft review" })).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe("Unsaved review");
    fireEvent.click(slot.getByRole("button", { name: /^Merge/ }));
    const dialog = await slot.findByRole("dialog");
    expect(dialog.textContent).toContain("Merge 2 pull requests");
    expect(dialog.textContent).toContain("#41 Base layer");
    expect(dialog.textContent).toContain("#42 Fix API");
    fireEvent.click(within(dialog).getByRole("button", { name: /Merge/ }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(merges).toBe(1);
    expect(await slot.findByText("merged")).toBeTruthy();
  } finally {
    slot.lifecycle.unmount();
  }
});
