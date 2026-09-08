// @vitest-environment jsdom
import { test, expect } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useState } from "react";

test("panel remounts reuse in-flight and completed PR details; refresh fetches again", async () => {
  installTestPluginRuntime();
  const { useReviewData } = await import("../../../src/ui/review/useReviewData");
  function Review() {
    const { detail, loading, refresh } = useReviewData(
      "cache-test",
      "https://github.com/org/api/pull/9",
    );
    return (
      <>
        <span>{loading ? "Loading" : detail?.pr.title}</span>
        <button onClick={refresh}>Refresh</button>
      </>
    );
  }
  function Panel() {
    const [visible, setVisible] = useState(true);
    return (
      <>
        <button onClick={() => setVisible(!visible)}>Switch tab</button>
        {visible && <Review />}
      </>
    );
  }
  let calls = 0;
  let resolve!: (value: unknown) => void;
  const slot = renderSlot(
    { component: Panel },
    {},
    {
      rpc: {
        linkedDetail: () => {
          calls++;
          return new Promise((done) => {
            resolve = done;
          });
        },
      },
    },
  );
  const switchTab = () => fireEvent.click(slot.getByText("Switch tab"));
  try {
    await waitFor(() => expect(calls).toBe(1));
    switchTab();
    switchTab();
    expect(calls).toBe(1);
    resolve({ pr: { title: "Cached PR" }, files: [] });
    await slot.findByText("Cached PR");
    switchTab();
    switchTab();
    expect(slot.queryByText("Loading")).toBeNull();
    await slot.findByText("Cached PR");
    expect(calls).toBe(1);
    fireEvent.click(slot.getByText("Refresh"));
    await waitFor(() => expect(calls).toBe(2));
    resolve({ pr: { title: "Updated PR" }, files: [] });
    await slot.findByText("Updated PR");
  } finally {
    slot.lifecycle.unmount();
  }
});
