// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useMediaQuery } from "../../src/ui/components/ui/hooks/use-media-query";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("media subscriptions survive rerenders, share listeners, and move when the query changes", () => {
  const queries = new Map<
    string,
    {
      matches: boolean;
      listeners: Set<() => void>;
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    }
  >();
  vi.stubGlobal("matchMedia", (query: string) => {
    let media = queries.get(query);
    if (!media) {
      const listeners = new Set<() => void>();
      media = {
        matches: false,
        listeners,
        addEventListener: vi.fn((_type, callback) => listeners.add(callback)),
        removeEventListener: vi.fn((_type, callback) => listeners.delete(callback)),
      };
      queries.set(query, media);
    }
    return media;
  });
  const first = renderHook(({ query }) => useMediaQuery(query), {
    initialProps: { query: "(max-width: 600px)" },
  });
  const narrow = queries.get("(max-width: 600px)")!;
  first.rerender({ query: "(max-width: 600px)" });
  expect(narrow.addEventListener).toHaveBeenCalledTimes(1);
  expect(narrow.removeEventListener).not.toHaveBeenCalled();
  const second = renderHook(() => useMediaQuery("(max-width: 600px)"));
  second.rerender();
  expect(narrow.addEventListener).toHaveBeenCalledTimes(1);
  expect(narrow.removeEventListener).not.toHaveBeenCalled();
  act(() => {
    narrow.matches = true;
    for (const notify of narrow.listeners) notify();
  });
  expect(first.result.current).toBe(true);
  expect(second.result.current).toBe(true);
  first.rerender({ query: "(prefers-reduced-motion: reduce)" });
  expect(first.result.current).toBe(false);
  expect(narrow.removeEventListener).not.toHaveBeenCalled();
  second.unmount();
  expect(narrow.removeEventListener).toHaveBeenCalledTimes(1);
  first.unmount();
  expect(
    queries.get("(prefers-reduced-motion: reduce)")!.removeEventListener,
  ).toHaveBeenCalledTimes(1);
});
