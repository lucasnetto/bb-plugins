// @vitest-environment jsdom
import { Schema } from "effect";
import { threadInput } from "../../src/shared/links-contract";
import { test, expect } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const pr = {
  number: 42,
  title: "Fix validation",
  url: "https://github.com/org/api/pull/42",
  headRefName: "fix",
  baseRefName: "main",
  author: "alice",
  isDraft: false,
};

test("linked PR picker opens the selected PR in its thread panel and unlink preserves the other PR", async () => {
  const app = await loadPluginApp(() => import("../../app"));

  let links = [42, 43].map((number) => ({
    ...pr,
    number,
    url: `https://github.com/org/api/pull/${number}`,
    repository: "org/api",
    state: "OPEN",
    reason: "manual",
    linkedAt: number,
  }));

  const slot = renderSlot(
    app.threadPanelActions.find((p) => p.id === "linked-prs")!,
    { threadId: "t1", params: null },
    {
      context: { threadId: "t1" },
      rpc: {
        linkedList: () => links,
        linkedUnlink: (input) => {
          const { url } = Schema.decodeUnknownSync(
            threadInput.pipe(Schema.fieldsAssign({ url: Schema.String })),
          )(input);

          links = links.filter((p) => p.url !== url);

          return { removed: true };
        },
      },
    },
  );

  try {
    const reviews = await slot.findAllByRole("link", { name: "Review" });
    const titles = slot.getAllByRole("link", { name: pr.title });

    for (const link of [titles[1], reviews[1]]) {
      expect(link.getAttribute("href")).toBe("https://github.com/org/api/pull/43");
      expect(link.getAttribute("target")).toBe("_blank");
      const before = slot.inspection.navigateCalls.length;
      expect(fireEvent.click(link, { metaKey: true })).toBe(true);
      expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
      expect(slot.inspection.navigateCalls).toHaveLength(before);
    }

    fireEvent.click(titles[1]);
    expect(JSON.stringify(slot.inspection.navigateCalls)).toContain(
      "https://github.com/org/api/pull/43",
    );
    fireEvent.click(reviews[1]);
    expect(JSON.stringify(slot.inspection.navigateCalls)).toContain(
      "https://github.com/org/api/pull/43",
    );
    fireEvent.click(slot.getAllByRole("button", { name: "Unlink" })[0]);
    await waitFor(() => expect(slot.getAllByRole("link", { name: "Review" })).toHaveLength(1));
    expect(links[0].number).toBe(43);
  } finally {
    slot.lifecycle.unmount();
  }
});
