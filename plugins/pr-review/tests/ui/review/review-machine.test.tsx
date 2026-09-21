// @vitest-environment jsdom
import { expect, it, vi } from "vite-plus/test";
import { act, fireEvent } from "@testing-library/react";
import { useEffect, useState } from "react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();

const { ReviewMachine } = await import("../../../src/ui/review/ReviewMachine");

const url = "https://github.com/org/repo/pull/42";

it("holds all PR children until ready, polls without waking, and stops polling afterward", async () => {
  vi.useFakeTimers();
  const mount = vi.fn();

  function Content() {
    useEffect(mount, []);

    return <p>PR content</p>;
  }

  const prepare = vi
    .fn()
    .mockResolvedValueOnce({ status: "waking" })
    .mockResolvedValue({ status: "ready" });

  const slot = renderSlot(
    { component: ReviewMachine },
    { threadId: "thread", url, children: <Content /> },
    { rpc: { prPrepare: prepare } },
  );

  try {
    await act(async () => {});
    expect(slot.getByRole("status").textContent).toBe("Waking machine…");
    expect(mount).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(slot.getByText("PR content")).toBeTruthy();
    expect(prepare.mock.calls.map(([input]) => input.wake)).toEqual([true, false]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(prepare).toHaveBeenCalledTimes(2);
  } finally {
    slot.lifecycle.unmount();
    vi.useRealTimers();
  }
});

it("lets the user retry a failed wake", async () => {
  const prepare = vi
    .fn()
    .mockRejectedValueOnce(new Error("Reconnect this machine"))
    .mockResolvedValue({ status: "ready" });

  const slot = renderSlot(
    { component: ReviewMachine },
    { threadId: null, url, children: <p>PR content</p> },
    { rpc: { prPrepare: prepare } },
  );

  try {
    expect(await slot.findByRole("alert")).toHaveProperty("textContent", "Reconnect this machine");
    expect(slot.queryByText("PR content")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await slot.findByText("PR content");
    expect(prepare.mock.calls.map(([input]) => input.wake)).toEqual([true, true]);
  } finally {
    slot.lifecycle.unmount();
  }
});

it("does not wake an inactive panel and ignores a pending result after unmount", async () => {
  vi.useFakeTimers();
  let finish!: (value: { status: string }) => void;

  const prepare = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );

  function Panel() {
    const [active, setActive] = useState(false);

    return (
      <>
        <button onClick={() => setActive(true)}>Open</button>
        <ReviewMachine threadId={null} url={url} active={active}>
          <p>PR content</p>
        </ReviewMachine>
      </>
    );
  }

  const slot = renderSlot({ component: Panel }, {}, { rpc: { prPrepare: prepare } });

  try {
    await act(async () => {});
    expect(prepare).not.toHaveBeenCalled();
    fireEvent.click(slot.getByText("Open"));
    await act(async () => {});
    expect(prepare).toHaveBeenCalledTimes(1);
    slot.lifecycle.unmount();
    await act(async () => {
      finish({ status: "waking" });
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(prepare).toHaveBeenCalledTimes(1);
  } finally {
    slot.lifecycle.unmount();
    vi.useRealTimers();
  }
});

it("stops waiting after five minutes and offers an explicit retry", async () => {
  vi.useFakeTimers();
  const prepare = vi.fn().mockResolvedValue({ status: "waking" });

  const slot = renderSlot(
    { component: ReviewMachine },
    { threadId: null, url, children: <p>PR content</p> },
    { rpc: { prPrepare: prepare } },
  );

  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(slot.getByRole("alert").textContent).toContain("taking longer than expected");
    expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
    const calls = prepare.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(prepare).toHaveBeenCalledTimes(calls);
    expect(prepare.mock.calls.filter(([input]) => input.wake)).toHaveLength(1);
  } finally {
    slot.lifecycle.unmount();
    vi.useRealTimers();
  }
});
