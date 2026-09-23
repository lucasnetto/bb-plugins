// @vitest-environment jsdom
import { test, expect, vi } from "vite-plus/test";
import { act } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useState } from "react";
import type { LinkedDetail } from "../../../src/shared/links-contract";
import type { useReviewDiff as UseReviewDiff } from "../../../src/ui/review/useReviewDiff";

test.each([false, true])(
  "selection survives input mode (touch=%s) and resets on revision changes",
  async (touch) => {
    vi.stubGlobal("matchMedia", () => ({
      matches: touch,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    installTestPluginRuntime();
    const { useReviewDiff } = await import("../../../src/ui/review/useReviewDiff");

    const detail: LinkedDetail = {
      pr: {
        url: "https://github.com/org/api/pull/8",
        repository: "org/api",
        number: 8,
        title: "Fix",
        state: "OPEN",
        isDraft: false,
      },
      body: "",
      headRefName: "fix",
      baseRefName: "main",
      repositoryRoot: null,
      files: [{ path: "api.ts", patch: "@@ -1 +1 @@\n-old\n+new" }],
    };

    let current!: ReturnType<typeof UseReviewDiff>;
    let refresh!: () => void;
    const renders: Array<ReturnType<typeof UseReviewDiff>> = [];

    function Probe() {
      const [revision, setRevision] = useState(0);
      const [, setSelectedPath] = useState<string | null>(null);
      const [, setError] = useState("");
      const [, setNotice] = useState("");
      refresh = () => setRevision((value) => value + 1);
      current = useReviewDiff({
        detail,
        threadId: "selection-revision-test",
        url: detail.pr.url,
        revision,
        setSelectedPath,
        setError,
        setNotice,
      });
      renders.push(current);

      return null;
    }

    const slot = renderSlot({ component: Probe }, {});

    try {
      expect(current.viewer.options.enableLineSelection).toBe(!touch);
      expect(current.viewer.options.onLineNumberClick).toEqual(
        touch ? expect.any(Function) : undefined,
      );

      const lines = { id: "0:api.ts", range: { start: 1, end: 1, side: "additions" as const } };
      act(() => current.selection.selectLines(lines));
      expect(current.selection.lines).toEqual(lines);
      expect(current.selection.path).toBe("api.ts");
      expect(current.viewer.items[0].annotations).toHaveLength(1);
      const selectedItem = current.viewer.items[0];
      const selectedAnchor = selectedItem.annotations![0];
      act(() => {
        current.display.setStyle("split");
        current.display.setWrap(true);
        current.display.toggleAllFiles();
      });
      expect(current.selection.lines).toEqual(lines);
      const viewerRef = current.viewer.ref;
      const beforeRefresh = renders.length;
      act(refresh);

      for (const render of renders.slice(beforeRefresh)) {
        expect(render.selection.lines).toBeNull();
        expect(render.selection.path).toBeNull();
        expect(render.viewer.items[0].annotations).toHaveLength(0);
      }

      expect(current.viewer.ref).toBe(viewerRef);
      expect(current.display.style).toBe("split");
      expect(current.display.wrap).toBe(true);
      expect(current.display.allFilesCollapsed).toBe(true);
      act(() => {
        // SAFETY: useReviewDiff installs a zero-argument closure that only updates the
        // selecting revision; the CodeView signature adds context unused by this handler.
        // No virtualized viewer exists in this hook test to supply that context.
        (current.viewer.options.onLineSelectionStart as () => void)();
        current.selection.selectLines(lines);
      });
      expect(current.viewer.items[0].annotations).toHaveLength(0);
      act(refresh);
      act(() => current.selection.selectLines(lines));
      // An unfinished drag from the previous revision cannot hide a new anchor.
      expect(current.viewer.items[0].annotations).toHaveLength(1);
      act(() => current.selection.clear());
      expect(current.selection.lines).toBeNull();
      expect(current.selection.path).toBeNull();
      expect(current.viewer.items[0].annotations).toHaveLength(0);
      slot.rerender(current.viewer.annotation(selectedAnchor, selectedItem, "Stale composer"));
      expect(slot.queryByText("Stale composer")).toBeNull();
    } finally {
      slot.lifecycle.unmount();
      vi.unstubAllGlobals();
    }
  },
);
