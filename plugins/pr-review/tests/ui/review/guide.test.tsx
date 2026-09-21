// @vitest-environment jsdom
import { test, expect, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { CodeViewDiffItem } from "@pierre/diffs";
import type { SavedGuide } from "../../../src/shared/guide-contract";

// jsdom has no layout observer; browser layout is verified in the live panel.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// Exercise the actual review controller independently of browser layout/virtualization.
vi.mock("../../../src/ui/review/StyledDiffCodeView", () => ({
  StyledDiffCodeView: ({ items }: { items: CodeViewDiffItem[] }) => (
    <div data-testid="diff-files">{items.map((item) => item.fileDiff.name).join(",")}</div>
  ),
}));

vi.mock("../../../src/ui/review/DiffFileTree", () => ({ DiffFileTree: () => null }));

const url = "https://github.com/org/api/pull/42";

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
  files: ["api.ts", "api.test.ts"].map((path) => ({
    path,
    status: "modified",
    patch: "@@ -1 +1 @@\n-old\n+new",
  })),
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
        title: "Reject invalid input",
        overview: "Validate before saving.",
        diffs: [{ file: "api.ts", summary: "Checks the request." }],
      },
      {
        title: "Exercise validation",
        overview: "Tests cover empty input.",
        diffs: [{ file: "api.test.ts", summary: "Asserts rejection." }],
      },
    ],
    unplacedFiles: [],
  },
  reviewed: [false, false],
};

async function component() {
  installTestPluginRuntime();

  return (await import("../../../src/ui/review/PrReview")).PrReview;
}

test("direct guide generation preserves the draft; chapter cards show their diffs and collapse when reviewed", async () => {
  let data: SavedGuide | null = null;

  const slot = renderSlot(
    { component: await component() },
    { threadId: "t1", url },
    {
      rpc: {
        prPrepare: () => ({ status: "ready" }),
        linkedList: () => [{ ...detail.pr, reason: "manual", linkedAt: 1 }],
        linkedDetail: () => detail,
        guideGet: () => data,
        guideJob: () => null,
        guideOptions: () => ({
          projectId: "p1",
          environmentId: "env",
          source: "thread",
          model: { providerId: "codex", model: "model", reasoningLevel: "high" },
        }),
        guideStart: () => ({
          id: "job",
          threadId: "t1",
          url,
          workerId: "worker",
          status: "running",
          error: "",
          base: saved.base,
          head: saved.head,
        }),
        guideProgress: () => {
          data = { ...saved, reviewed: [false, true] };

          return data;
        },
      },
    },
  );

  try {
    fireEvent.mouseDown(await slot.findByRole("tab", { name: "Code" }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(slot.getByTestId("diff-files").textContent).toBe("api.ts,api.test.ts"),
    );
    await slot.behavior.setComposerText("Existing draft");
    fireEvent.click(slot.getByRole("button", { name: "Guide" }));
    const request = await slot.findByRole("button", { name: "Generate guide" });
    await waitFor(() => expect(request.hasAttribute("disabled")).toBe(false));
    fireEvent.click(request);
    const dialog = await slot.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Starts with your thread default"));
    const buttons = slot.getAllByRole("button", { name: "Generate guide" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.inspection.composer.mentions).toHaveLength(0);
    expect(slot.inspection.composer.text).toBe("Existing draft");
    expect(slot.inspection.composer.submits).toHaveLength(0);
    data = saved;
    await slot.behavior.emitRealtime("review-guide-changed", { threadId: "t1", url });
    await slot.findByRole("heading", { name: "Reject invalid input" });
    await slot.findByRole("heading", { name: "Exercise validation" });
    expect(slot.getAllByTestId("diff-files").map((file) => file.textContent)).toEqual([
      "api.ts",
      "api.test.ts",
    ]);
    fireEvent.click(slot.getByRole("checkbox", { name: "Reviewed: Exercise validation" }));
    await slot.findByText("1 / 2 reviewed");
    expect(slot.getByTestId("diff-files").textContent).toBe("api.ts");
    fireEvent.click(slot.getByRole("button", { name: "Expand chapter: Exercise validation" }));
    expect(slot.getAllByTestId("diff-files").map((file) => file.textContent)).toEqual([
      "api.ts",
      "api.test.ts",
    ]);
    fireEvent.click(slot.getByRole("button", { name: "Guide" }));
    expect(slot.getByTestId("diff-files").textContent).toBe("api.ts,api.test.ts");
  } finally {
    slot.lifecycle.unmount();
  }
});

test("a stale guide cannot present its chapters against a newer PR diff", async () => {
  const slot = renderSlot(
    { component: await component() },
    { threadId: "stale-guide-thread", url },
    {
      rpc: {
        prPrepare: () => ({ status: "ready" }),
        linkedList: () => [{ ...detail.pr, reason: "manual", linkedAt: 1 }],
        linkedDetail: () => ({ ...detail, headRefOid: "c".repeat(40) }),
        guideGet: () => saved,
        guideJob: () => null,
      },
    },
  );

  try {
    fireEvent.mouseDown(await slot.findByRole("tab", { name: "Code" }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(slot.getByTestId("diff-files").textContent).toBe("api.ts,api.test.ts"),
    );
    fireEvent.click(slot.getByRole("button", { name: "Guide" }));
    await slot.findByText(/Generated on an earlier revision/);
    expect(
      slot
        .getByRole("checkbox", { name: "Reviewed: Reject invalid input" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(slot.getByRole("heading", { name: "Reject invalid input" })).toBeTruthy();
    expect(slot.queryByTestId("diff-files")).toBeNull();
  } finally {
    slot.lifecycle.unmount();
  }
});

test("guide diffs follow the chapter reading order rather than GitHub file order", async () => {
  const ordered: SavedGuide = {
    ...saved,
    guide: {
      ...saved.guide,
      sections: [
        {
          title: "Start with the test",
          overview: "Read the expected behavior before its implementation.",
          diffs: [
            { file: "api.test.ts", summary: "Expected behavior." },
            { file: "api.ts", summary: "Implementation." },
          ],
        },
      ],
    },
    reviewed: [false],
  };

  const slot = renderSlot(
    { component: await component() },
    { threadId: "t1", url },
    {
      rpc: {
        prPrepare: () => ({ status: "ready" }),
        linkedList: () => [{ ...detail.pr, reason: "manual", linkedAt: 1 }],
        linkedDetail: () => detail,
        guideGet: () => ordered,
      },
    },
  );

  try {
    fireEvent.mouseDown(await slot.findByRole("tab", { name: "Code" }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(slot.getByTestId("diff-files").textContent).toBe("api.ts,api.test.ts"),
    );
    fireEvent.click(slot.getByRole("button", { name: "Guide" }));
    await slot.findByRole("heading", { name: "Start with the test" });
    expect(slot.getAllByTestId("diff-files").map((file) => file.textContent)).toEqual([
      "api.test.ts",
      "api.ts",
    ]);
  } finally {
    slot.lifecycle.unmount();
  }
});

test("cancelling generation keeps chapter progress blocked until cancellation completes", async () => {
  let running = true;
  let finishCancel!: () => void;

  const cancellation = new Promise<void>((resolve) => {
    finishCancel = resolve;
  });

  const slot = renderSlot(
    { component: await component() },
    { threadId: "t1", url },
    {
      rpc: {
        prPrepare: () => ({ status: "ready" }),
        linkedList: () => [{ ...detail.pr, reason: "manual", linkedAt: 1 }],
        linkedDetail: () => detail,
        guideGet: () => saved,
        guideJob: () =>
          running
            ? {
                id: "job",
                threadId: "t1",
                url,
                workerId: "worker",
                status: "running",
                base: saved.base,
                head: saved.head,
              }
            : null,
        guideCancel: async () => {
          await cancellation;
          running = false;

          return null;
        },
      },
    },
  );

  try {
    fireEvent.mouseDown(await slot.findByRole("tab", { name: "Code" }), {
      button: 0,
      ctrlKey: false,
    });
    await slot.findByTestId("diff-files");
    fireEvent.click(slot.getByRole("button", { name: "Guide" }));
    const cancel = await slot.findByRole("button", { name: "Cancel generation" });
    fireEvent.click(cancel);
    await waitFor(() => expect(cancel.hasAttribute("disabled")).toBe(true));
    const reviewed = slot.getByRole("checkbox", { name: "Reviewed: Reject invalid input" });
    expect(reviewed.hasAttribute("disabled")).toBe(true);
    finishCancel();
    await waitFor(() =>
      expect(slot.queryByRole("button", { name: "Cancel generation" })).toBeNull(),
    );
    await waitFor(() => expect(reviewed.hasAttribute("disabled")).toBe(false));
  } finally {
    finishCancel();
    slot.lifecycle.unmount();
  }
});
