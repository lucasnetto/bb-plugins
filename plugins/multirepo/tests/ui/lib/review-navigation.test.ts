// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { listenForReviewRequests } from "../../../src/ui/lib/review-navigation";

test("review handoff consumes once on mount or event, isolates threads, and removes its listener", () => {
  const url = "https://github.com/org/api/pull/42";
  const opened: unknown[] = [];
  sessionStorage.clear();
  sessionStorage.setItem("bb:multirepo:open-review:t1", url);
  sessionStorage.setItem("bb:multirepo:open-review:t2", url);
  const stop = listenForReviewRequests("t1", (request) => opened.push(request));
  try {
    expect(opened).toEqual([{ url, title: "org/api #42" }]);
    expect(sessionStorage.getItem("bb:multirepo:open-review:t1")).toBeNull();
    expect(sessionStorage.getItem("bb:multirepo:open-review:t2")).toBe(url);
    window.dispatchEvent(new Event("bb:multirepo:open-review"));
    expect(opened).toHaveLength(1);
    sessionStorage.setItem("bb:multirepo:open-review:t1", "https://example.com/not-a-pr");
    window.dispatchEvent(new Event("bb:multirepo:open-review"));
    expect(opened).toHaveLength(1);
    sessionStorage.setItem("bb:multirepo:open-review:t1", url);
    window.dispatchEvent(new Event("bb:multirepo:open-review"));
    expect(opened).toHaveLength(2);
    stop();
    sessionStorage.setItem("bb:multirepo:open-review:t1", url);
    window.dispatchEvent(new Event("bb:multirepo:open-review"));
    expect(opened).toHaveLength(2);
    expect(sessionStorage.getItem("bb:multirepo:open-review:t1")).toBe(url);
  } finally {
    stop();
    sessionStorage.clear();
  }
});
