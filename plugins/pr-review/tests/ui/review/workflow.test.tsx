// @vitest-environment jsdom
import { test, expect, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ReactNode } from "react";
import type { CodeViewDiffItem } from "@pierre/diffs";
import type { ReviewSelection } from "../../../src/ui/review/useReviewDiff";

// Substitute only the virtualized renderer. The controller, hydration header,
// data/composer hooks, and source-context extraction run as in the plugin.
vi.mock("../../../src/ui/review/StyledDiffCodeView", () => ({
  StyledDiffCodeView: ({
    items,
    renderHeaderPrefix,
    onSelectedLinesChange,
  }: {
    items: CodeViewDiffItem[];
    renderHeaderPrefix?: (item: CodeViewDiffItem) => ReactNode;
    onSelectedLinesChange?: (selection: ReviewSelection) => void;
  }) => (
    <div data-testid="viewer">
      {items.map((item) => (
        <div key={item.id}>
          {renderHeaderPrefix?.(item)}
          <button
            disabled={item.fileDiff.isPartial}
            onClick={() =>
              onSelectedLinesChange?.({
                id: item.id,
                range: { start: 1, end: 1, side: "additions" },
              })
            }
          >
            Select unchanged line in {item.fileDiff.name}
          </button>
        </div>
      ))}
    </div>
  ),
}));
vi.mock("../../../src/ui/review/DiffFileTree", () => ({ DiffFileTree: () => null }));

test("expanded context reaches the draft with exact revisions and refresh reloads its contents", async () => {
  installTestPluginRuntime();
  const { PrReview } = await import("../../../src/ui/review/PrReview");
  const url = "https://github.com/org/api/pull/42";
  const base = "a".repeat(40);
  let head = "b".repeat(40);
  let contextLine = "before";
  const staged: unknown[] = [];
  const contentsRequests: unknown[] = [];
  const slot = renderSlot(
    { component: PrReview },
    { threadId: "t1", url },
    {
      rpc: {
        linkedDetail: () => ({
          pr: {
            url,
            repository: "org/api",
            number: 42,
            title: "Fix",
            state: "OPEN",
            isDraft: false,
          },
          body: "",
          baseRefName: "main",
          headRefName: "fix",
          baseRefOid: base,
          headRefOid: head,
          repositoryRoot: null,
          files: [{ path: "api.ts", status: "modified", patch: "@@ -2 +2 @@\n-old\n+new" }],
        }),
        guideGet: () => null,
        guideJob: () => null,
        linkedContents: (input) => {
          contentsRequests.push(input);
          return {
            oldContents: `${contextLine}\nold\nafter\n`,
            newContents: `${contextLine}\nnew\nafter\n`,
          };
        },
        stageReviewComment: (input) => {
          staged.push(input);
          return { id: "comment-1" };
        },
      },
    },
  );
  try {
    const select = await slot.findByRole("button", { name: "Select unchanged line in api.ts" });
    await waitFor(() => expect(select.hasAttribute("disabled")).toBe(false));
    await slot.behavior.setComposerText("Existing draft");
    fireEvent.click(select);
    fireEvent.change(await slot.findByLabelText("Comment on selected code"), {
      target: { value: "Check this line" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Add to chat ⌘↵" }));
    await slot.findByText("Added to your draft.");
    expect(staged).toEqual([
      {
        threadId: "t1",
        url,
        label: "api.ts · 1–1",
        context: `PR: ${url}\nFile: "api.ts"\nHead: ${head}\nBase: ${base}\nLines: new 1–new 1\n\x60\x60\x60diff\n before\n\x60\x60\x60`,
      },
    ]);
    expect(slot.inspection.composer.text).toContain("Existing draft\n\nCheck this line");
    expect(JSON.stringify(slot.inspection.composer.mentions)).toContain("comment-1");
    const viewer = slot.getByTestId("viewer");
    fireEvent.click(slot.getByRole("button", { name: "Collapse context" }));
    expect(slot.getByTestId("viewer")).toBe(viewer);
    expect(contentsRequests).toHaveLength(1);
    head = "c".repeat(40);
    contextLine = "updated before";
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(contentsRequests).toHaveLength(2));
    const selectUpdated = slot.getByRole("button", { name: "Select unchanged line in api.ts" });
    await waitFor(() => expect(selectUpdated.hasAttribute("disabled")).toBe(false));
    fireEvent.click(selectUpdated);
    fireEvent.click(slot.getByRole("button", { name: "Explain" }));
    await waitFor(() => expect(staged).toHaveLength(2));
    expect(JSON.stringify(staged[1])).toContain(head);
    expect(JSON.stringify(staged[1])).toContain("updated before");
  } finally {
    slot.lifecycle.unmount();
  }
});

test("draft review attaches exact code context locally without calling thread or guide APIs", async () => {
  installTestPluginRuntime();
  const { DraftPrReview } = await import("../../../src/ui/review/PrReview");
  const comments: unknown[] = [];
  const url = "https://github.com/org/api/pull/789";
  const slot = renderSlot(
    { component: DraftPrReview },
    { url, onComment: (comment) => comments.push(comment) },
    {
      rpc: {
        reviewDraftDetail: () => ({
          pr: {
            url,
            repository: "org/api",
            number: 789,
            title: "Draft PR",
            state: "OPEN",
            isDraft: false,
          },
          body: "",
          baseRefName: "main",
          headRefName: "fix",
          baseRefOid: "a".repeat(40),
          headRefOid: "b".repeat(40),
          repositoryRoot: null,
          files: [{ path: "api.ts", status: "modified", patch: "@@ -2 +2 @@\n-old\n+new" }],
        }),
        reviewDraftContents: () => ({
          oldContents: "context\nold\nafter\n",
          newContents: "context\nnew\nafter\n",
        }),
      },
    },
  );
  try {
    const select = await slot.findByRole("button", { name: "Select unchanged line in api.ts" });
    await waitFor(() => expect(select.hasAttribute("disabled")).toBe(false));
    fireEvent.click(select);
    fireEvent.change(await slot.findByLabelText("Comment on selected code"), {
      target: { value: "Why this branch?" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Add to chat ⌘↵" }));
    await waitFor(() => expect(comments).toHaveLength(1));
    expect(comments[0]).toMatchObject({
      text: "Why this branch?",
      label: "api.ts · 1–1",
      context: expect.stringContaining("Head: " + "b".repeat(40)),
    });
    expect(
      slot.inspection.rpcCalls
        .map((call) => call.method)
        .every((method) => ["reviewDraftDetail", "reviewDraftContents"].includes(method)),
    ).toBe(true);
    expect(slot.queryByRole("button", { name: "Guide" })).toBeNull();
  } finally {
    slot.lifecycle.unmount();
  }
});
