// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useState } from "react";
import { overview } from "../../workspace-fixture";
import type { Overview } from "../../../src/shared/workspace-contract";

afterEach(() => vi.restoreAllMocks());

it("returns from thread B to A without refetching its overview, absent stack, or timeline", async () => {
  installTestPluginRuntime();
  const { PullRequestDetail } = await import("../../../src/ui/workspace/PullRequestDetail");

  function Panel() {
    const [thread, setThread] = useState("cache-A");

    return (
      <>
        <button onClick={() => setThread(thread === "cache-A" ? "cache-B" : "cache-A")}>
          Switch thread
        </button>
        <PullRequestDetail key={thread} threadId={thread} url={overview.url} code={null} />
      </>
    );
  }

  const prOverview = vi.fn(({ threadId }) => ({ ...overview, title: threadId }));
  const prStack = vi.fn(() => null);
  const prTimeline = vi.fn(() => ({ entries: [], nextPage: null, truncated: false }));
  const slot = renderSlot({ component: Panel }, {}, { rpc: { prOverview, prStack, prTimeline } });

  try {
    await slot.findByRole("heading", { name: "cache-A" });
    await waitFor(() => expect(prTimeline).toHaveBeenCalledTimes(1));
    fireEvent.click(slot.getByText("Switch thread"));
    await slot.findByRole("heading", { name: "cache-B" });
    await waitFor(() => expect(prTimeline).toHaveBeenCalledTimes(2));
    fireEvent.click(slot.getByText("Switch thread"));
    expect(slot.getByRole("heading", { name: "cache-A" })).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(prOverview).toHaveBeenCalledTimes(2);
    expect(prStack).toHaveBeenCalledTimes(2);
    expect(prTimeline).toHaveBeenCalledTimes(2);
  } finally {
    slot.lifecycle.unmount();
  }
});

it("shares requests across remounts and keeps old data during expired or failed refreshes", async () => {
  installTestPluginRuntime();
  const { useWorkspaceData } = await import("../../../src/ui/workspace/useWorkspaceData");
  let now = 100000;
  vi.spyOn(Date, "now").mockImplementation(() => now);

  function Review() {
    const data = useWorkspaceData("cache-pending", overview.url, true);

    return (
      <>
        <span>{data.detail?.title ?? "Loading"}</span>
        <span>{data.error}</span>
        <button onClick={() => void data.refresh()}>Refresh</button>
        <button onClick={() => void data.mutate({ kind: "ready" })}>Ready</button>
      </>
    );
  }

  function Panel() {
    const [visible, setVisible] = useState(true);

    return (
      <>
        <button onClick={() => setVisible(!visible)}>Switch</button>
        {visible && <Review />}
      </>
    );
  }

  let resolve!: (value: Overview) => void;
  let reject!: (reason: Error) => void;

  const prOverview = vi.fn(
    () =>
      new Promise<Overview>((done, fail) => {
        resolve = done;
        reject = fail;
      }),
  );

  const prStack = vi.fn(() => null);

  const slot = renderSlot(
    { component: Panel },
    {},
    {
      rpc: { prOverview, prStack, prAction: () => ({ message: "Ready", pendingMergeId: null }) },
    },
  );

  const toggle = () => fireEvent.click(slot.getByText("Switch"));

  try {
    await waitFor(() => expect(prOverview).toHaveBeenCalledTimes(1));
    toggle();
    toggle();
    await act(async () => {});
    expect(prOverview).toHaveBeenCalledTimes(1);
    toggle();
    await act(async () => resolve(overview));
    toggle();
    expect(slot.getByText("Fix API")).toBeTruthy();
    await act(async () => {});
    expect(prOverview).toHaveBeenCalledTimes(1);

    toggle();
    now += 60001;
    toggle();
    expect(slot.queryByText("Loading")).toBeNull();
    await waitFor(() => expect(prOverview).toHaveBeenCalledTimes(2));
    await act(async () => reject(new Error("offline")));
    expect(slot.getByText("Fix API")).toBeTruthy();
    expect(slot.getByText(/offline/)).toBeTruthy();
    fireEvent.click(slot.getByText("Refresh"));
    await waitFor(() => expect(prOverview).toHaveBeenCalledTimes(3));
    await act(async () => resolve({ ...overview, title: "Refreshed" }));
    expect(slot.getByText("Refreshed")).toBeTruthy();
    fireEvent.click(slot.getByText("Refresh"));
    await waitFor(() => expect(prOverview).toHaveBeenCalledTimes(4));
    const oldRead = resolve;
    fireEvent.click(slot.getByText("Ready"));
    await waitFor(() => expect(prOverview).toHaveBeenCalledTimes(5));
    await act(async () => resolve({ ...overview, title: "After action" }));
    await act(async () => oldRead({ ...overview, title: "Stale before action" }));
    expect(slot.getByText("After action")).toBeTruthy();
    toggle();
    toggle();
    expect(slot.getByText("After action")).toBeTruthy();
    await act(async () => {});
    expect(prOverview).toHaveBeenCalledTimes(5);
  } finally {
    slot.lifecycle.unmount();
  }
});
