// @vitest-environment jsdom
import { Schema } from "effect";
import { threadInput, type LinkedPr } from "../../src/shared/links-contract";
import { expect, test } from "vite-plus/test";
import { act, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();

const { LinkedPrsPanel } = await import("../../src/ui/linked-prs");

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

  let finish!: (value: LinkedPr[]) => void;

  const slot = renderSlot(
    { component: Panel },
    {},
    {
      rpc: {
        linkedList: (input) =>
          Schema.decodeUnknownSync(threadInput)(input).threadId === "first"
            ? new Promise<LinkedPr[]>((resolve) => {
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
    const input = slot.getByRole("textbox");

    if (!(input instanceof HTMLInputElement)) throw new Error("Expected URL input");
    expect(input.value).toBe("");
    await act(async () =>
      finish([
        {
          url: "https://github.com/old/repo/pull/1",
          title: "Old PR",
          isDraft: false,
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
