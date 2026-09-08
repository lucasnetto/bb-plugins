// @vitest-environment jsdom
import { test, expect, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";

vi.mock("../../../src/ui/review/StyledDiffCodeView", () => ({ StyledDiffCodeView: () => null }));
vi.mock("../../../src/ui/review/DiffFileTree", () => ({ DiffFileTree: () => null }));
const url = "https://github.com/org/api/pull/456";
const comment = {
  id: "c1",
  label: "api.ts · 12",
  text: "Could this value be null?",
  context: "Head: abc\nBase: def\nLines: new 12\nreturn value.id;",
};

test("draft comments persist across remounts, and only Send creates and opens a thread", async () => {
  installTestPluginRuntime();
  sessionStorage.clear();
  const { ReviewDraftPage } = await import("../../../src/ui/review-draft/ReviewDraftPage");
  const { useDraftComments } = await import("../../../src/ui/review-draft/comments");
  function Fixture() {
    const draft = useDraftComments(url);
    return (
      <>
        <button onClick={() => draft.add(comment)}>Add selected code</button>
        <button onClick={() => draft.add({ ...comment, id: "c2", text: "A later comment" })}>
          Add later comment
        </button>
        <ReviewDraftPage subPath={"org/api/456"} />
      </>
    );
  }
  const sends: unknown[] = [];
  let finishSend: (() => void) | undefined;
  const mount = () =>
    renderSlot(
      { component: Fixture },
      {},
      {
        rpc: {
          reviewDraftDefaults: () => ({ projectId: "personal", hostId: "primary" }),
          startReview: (input) => {
            sends.push(input);
            return new Promise((resolve) => {
              finishSend = () => resolve({ threadId: "created", warning: null });
            });
          },
        },
        experimental_openFixedTab: () => true,
      },
    );
  let slot = mount();
  try {
    await slot.findByTestId("bb-new-thread-composer");
    expect(sends).toEqual([]);
    fireEvent.click(slot.getByText("Add selected code"));
    await slot.findByText(comment.text);
    expect(sends).toEqual([]);
    slot.lifecycle.unmount();
    slot = mount();
    await slot.findByTestId("bb-new-thread-composer");
    expect(slot.getByText(comment.text)).toBeTruthy();
    fireEvent.change(slot.getByTestId("bb-new-thread-composer-input"), {
      target: { value: "Explain the null case" },
    });
    fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(sends[0]).toMatchObject({
      url,
      comments: [comment],
      request: { input: [{ type: "text", text: "Explain the null case" }] },
    });
    fireEvent.click(slot.getByText("Add later comment"));
    finishSend?.();
    await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(1));
    expect(sessionStorage.getItem("bb:pr-review:open-review:created")).toBe(url);
    expect(slot.queryByText(comment.text)).toBeNull();
    expect(slot.getByText("A later comment")).toBeTruthy();
  } finally {
    finishSend?.();
    slot.lifecycle.unmount();
  }
});
