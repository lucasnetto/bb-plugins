import { overview } from "../../workspace-fixture";
// @vitest-environment jsdom
import { test, expect, vi } from "vite-plus/test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { CodeViewDiffItem } from "@pierre/diffs";
import type { SavedGuide } from "../../../src/shared/guide-contract";
import type {
  ReviewAnnotationRenderer,
  ReviewSelection,
} from "../../../src/ui/review/useReviewDiff";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// Keep the review controller and hooks real; replace the layout-dependent viewer.
vi.mock("../../../src/ui/review/StyledDiffCodeView", () => ({
  StyledDiffCodeView: ({
    items,
    renderAnnotation,
    onSelectedLinesChange,
  }: {
    items: CodeViewDiffItem[];
    renderAnnotation?: ReviewAnnotationRenderer;
    onSelectedLinesChange?: (selection: ReviewSelection) => void;
  }) => (
    <div>
      {items.map((item) => (
        <div key={item.id}>
          <button
            onClick={() =>
              onSelectedLinesChange?.({
                id: item.id,
                range: { start: 1, end: 1, side: "additions" },
              })
            }
          >
            Select line in {item.fileDiff.name}
          </button>
          {item.annotations?.map((anchor) => (
            <div key={`${anchor.side}:${anchor.lineNumber}`}>
              {renderAnnotation?.(anchor, item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("../../../src/ui/review/DiffFileTree", () => ({ DiffFileTree: () => null }));

test("background guides preserve code selection; toggles and active guide replacement clear it", async () => {
  installTestPluginRuntime();
  const { PrReview } = await import("../../../src/ui/review/PrReview");
  const url = "https://github.com/org/api/pull/guide-selection";

  const detail = {
    pr: {
      url,
      repository: "org/api",
      number: 42,
      title: "Validate requests",
      state: "OPEN",
      isDraft: false,
    },
    body: "",
    headRefName: "fix",
    baseRefName: "main",
    repositoryRoot: null,
    baseRefOid: "a".repeat(40),
    headRefOid: "b".repeat(40),
    files: [{ path: "api.ts", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" }],
  };

  const saved: SavedGuide = {
    id: "guide-1",
    base: detail.baseRefOid,
    head: detail.headRefOid,
    guide: {
      title: "Input validation",
      intent: "Reject empty requests.",
      sections: [
        {
          title: "Validate input",
          overview: "Check requests.",
          diffs: [{ file: "api.ts", summary: "Validate the request." }],
        },
      ],
      unplacedFiles: [],
    },
    reviewed: [false],
  };

  let data: SavedGuide | null = null;

  const slot = renderSlot(
    { component: PrReview },
    { threadId: "guide-selection", url },
    {
      rpc: {
        prOverview: () => ({ ...overview, url }),
        prStack: () => null,
        prTimeline: () => ({ entries: [], nextPage: null, truncated: false }),
        linkedList: () => [{ ...detail.pr, reason: "manual", linkedAt: 1 }],
        linkedDetail: () => detail,
        guideGet: () => data,
        guideJob: () => null,
        stageReviewComment: () => ({ id: "guide-selection-comment" }),
      },
    },
  );

  const select = () => fireEvent.click(slot.getByRole("button", { name: "Select line in api.ts" }));
  const toggle = () => fireEvent.click(slot.getByRole("button", { name: "Guide" }));

  const publish = async (next: SavedGuide) => {
    data = next;
    await act(async () => {
      await slot.behavior.emitRealtime("review-guide-changed", {
        threadId: "guide-selection",
        url,
      });
    });
  };

  const expectCleared = () => {
    expect(slot.queryByLabelText("Comment on selected code")).toBeNull();
    expect(slot.getByText("Select a file or lines")).toBeTruthy();
  };

  try {
    fireEvent.mouseDown(slot.getByRole("tab", { name: "Code" }), { button: 0, ctrlKey: false });
    await slot.findByRole("button", { name: "Select line in api.ts" });
    select();
    const input = await slot.findByLabelText("Comment on selected code");
    fireEvent.change(input, { target: { value: "Keep this draft" } });

    await publish(saved);
    expect(slot.getByLabelText("Comment on selected code")).toBe(input);
    expect(input).toHaveProperty("value", "Keep this draft");
    expect(slot.getByText("api.ts · 1–1")).toBeTruthy();

    await publish({ ...saved, id: "guide-2" });
    expect(slot.getByLabelText("Comment on selected code")).toBe(input);
    expect(input).toHaveProperty("value", "Keep this draft");

    toggle();
    await slot.findByText("Input validation");
    expectCleared();
    select();
    expect(slot.getByLabelText("Comment on selected code")).toHaveProperty(
      "value",
      "Keep this draft",
    );
    await publish({
      ...saved,
      id: "guide-2",
      guide: { ...saved.guide, intent: "Updated intent." },
    });
    expect(slot.getByLabelText("Comment on selected code")).toHaveProperty(
      "value",
      "Keep this draft",
    );

    await publish({
      ...saved,
      id: "guide-3",
      guide: { ...saved.guide, title: "Replacement guide" },
    });
    await slot.findByText("Replacement guide");
    await waitFor(expectCleared);
    select();
    expect(slot.getByLabelText("Comment on selected code")).toBeTruthy();
    toggle();
    expectCleared();

    fireEvent.click(slot.getByRole("button", { name: "Ask" }));
    await slot.findByText("Added to your draft.");

    const detailCalls = () =>
      slot.inspection.rpcCalls.filter((call) => call.method === "linkedDetail").length;

    const beforeRefresh = detailCalls();
    fireEvent.click(slot.getByRole("button", { name: "Refresh pull request" }));
    await waitFor(() => expect(detailCalls()).toBe(beforeRefresh + 1));
    await waitFor(() => expect(slot.queryByText("Loading diff…")).toBeNull());
    expect(slot.getByText("Added to your draft.")).toBeTruthy();
    detail.headRefOid = "c".repeat(40);
    fireEvent.click(slot.getByRole("button", { name: "Refresh pull request" }));
    await waitFor(() => expect(detailCalls()).toBe(beforeRefresh + 2));
    await waitFor(() => expect(slot.queryByText("Added to your draft.")).toBeNull());
  } finally {
    slot.lifecycle.unmount();
  }
});
