// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();

const { LinkedPrProvider, useLinkedPrs } =
  await import("../../src/ui/components/sidebar/LinkedPrs");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Links() {
  return (
    <span>
      {useLinkedPrs("one")
        .map((pr) => pr.title)
        .join(",")}
    </span>
  );
}

function Panel() {
  return (
    <LinkedPrProvider>
      <Links />
    </LinkedPrProvider>
  );
}

const links = (title: string) => ({
  one: [
    {
      url: "https://github.com/org/repo/pull/1",
      repository: "org/repo",
      number: 1,
      title,
      isDraft: false,
      state: "OPEN",
    },
  ],
});

test.each([
  { one: [{ ...links("Invalid").one[0], url: "https://example.com/pull/1" }] },
  { one: [{ ...links("Invalid").one[0], number: "1" }] },
  { one: [{ ...links("Invalid").one[0], state: "UNKNOWN" }] },
  { one: [{ ...links("Invalid").one[0], isDraft: null }] },
  { one: "not a PR list" },
])("malformed linked PR responses clear previously loaded links: %j", async (payload) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => links("Valid PR") })
      .mockResolvedValueOnce({ ok: true, json: async () => payload }),
  );
  const slot = renderSlot({ component: Panel }, {});
  await slot.findByText("Valid PR");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(slot.queryByText("Valid PR")).toBeNull();
  expect(slot.queryByText("Invalid")).toBeNull();
  slot.lifecycle.unmount();
});

test.each(["success", "failure"])(
  "an aborted request's late %s cannot overwrite newer linked PRs",
  async (outcome) => {
    let resolve!: (value: ReturnType<typeof links>) => void;
    let reject!: (error: Error) => void;

    const oldBody = new Promise<ReturnType<typeof links>>((yes, no) => {
      resolve = yes;
      reject = no;
    });

    const json = vi.fn(() => oldBody);

    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json })
      .mockResolvedValueOnce({ ok: true, json: async () => links("Newest PR") });

    vi.stubGlobal("fetch", fetch);
    const slot = renderSlot({ component: Panel }, {});
    await act(async () => {});
    expect(json).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(slot.getByText("Newest PR")).toBeTruthy();
    await act(async () => {
      if (outcome === "success") resolve(links("Old PR"));
      else reject(new Error("Old response failed"));
    });
    expect(slot.getByText("Newest PR")).toBeTruthy();
    slot.lifecycle.unmount();
  },
);
