// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { act, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();
const { LinkedPrsPanel } = await import("../../src/ui/linked-prs");

test("opening a review does not also fetch the hidden picker", async () => {
  const linkedList = vi.fn(() => new Promise(() => {}));
  const slot = renderSlot(
    { component: LinkedPrsPanel },
    { threadId: "review-lifecycle", params: { url: "https://github.com/org/repo/pull/1" } },
    { rpc: { linkedList } },
  );
  try {
    await act(async () => {});
    expect(linkedList).toHaveBeenCalledTimes(1);
    expect(slot.getByText("Opening pull request…")).toBeTruthy();
  } finally {
    slot.lifecycle.unmount();
  }
});

test("switching threads resets the linked picker and ignores the previous list response", async () => {
  function Panel() {
    const [threadId, setThreadId] = useState("first");
    return (
      <>
        <button onClick={() => setThreadId("second")}>Switch thread</button>
        <LinkedPrsPanel threadId={threadId} params={null} />
      </>
    );
  }
  let finish!: (value: unknown) => void;
  const slot = renderSlot(
    { component: Panel },
    {},
    {
      rpc: {
        linkedList: (input) =>
          (input as { threadId: string }).threadId === "first"
            ? new Promise((resolve) => {
                finish = resolve;
              })
            : [],
      },
    },
  );
  try {
    fireEvent.change(slot.getByRole("textbox"), {
      target: { value: "https://github.com/old/repo/pull/1" },
    });
    fireEvent.click(slot.getByText("Switch thread"));
    expect((slot.getByRole("textbox") as HTMLInputElement).value).toBe("");
    await act(async () =>
      finish([
        {
          url: "https://github.com/old/repo/pull/1",
          title: "Old PR",
          repository: "old/repo",
          number: 1,
          state: "OPEN",
          reason: "manual",
          linkedAt: 1,
        },
      ]),
    );
    expect(slot.queryByText("Old PR")).toBeNull();
  } finally {
    slot.lifecycle.unmount();
  }
});
