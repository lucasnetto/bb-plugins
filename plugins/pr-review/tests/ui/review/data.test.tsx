// @vitest-environment jsdom
import type { LinkedDetail } from "../../../src/shared/links-contract";
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
  let resolve!: (value: LinkedDetail) => void;

  const detail: LinkedDetail = {
    pr: {
      url: "https://github.com/org/api/pull/9",
      repository: "org/api",
      number: 9,
      title: "Cached PR",
      state: "OPEN",
      isDraft: false,
    },
    body: "",
    headRefName: "fix",
    baseRefName: "main",
    repositoryRoot: null,
    files: [],
  };

  const slot = renderSlot(
    { component: Panel },
    {},
    {
      rpc: {
        linkedDetail: () => {
          calls++;

          return new Promise<LinkedDetail>((done) => {
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
    resolve(detail);
    await slot.findByText("Cached PR");
    switchTab();
    switchTab();
    expect(slot.queryByText("Loading")).toBeNull();
    await slot.findByText("Cached PR");
    expect(calls).toBe(1);
    fireEvent.click(slot.getByText("Refresh"));
    await waitFor(() => expect(calls).toBe(2));
    expect(slot.queryByText("Loading")).toBeNull();
    expect(slot.getByText("Cached PR")).toBeTruthy();
    resolve({ ...detail, pr: { ...detail.pr, title: "Updated PR" } });
    await slot.findByText("Updated PR");
  } finally {
    slot.lifecycle.unmount();
  }
});
