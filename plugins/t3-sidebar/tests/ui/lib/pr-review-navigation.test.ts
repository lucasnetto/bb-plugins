// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { requestLinkedReview } from "../../../src/ui/lib/pr-review-navigation";

test("sidebar stores the review before navigation and signals after navigation", () => {
  const url = "https://github.com/org/api/pull/42";
  const order: string[] = [];
  const receive = () => order.push("event");
  window.addEventListener("bb:pr-review:open-review", receive);
  try {
    requestLinkedReview("t1", url, (threadId) => {
      expect(threadId).toBe("t1");
      expect(sessionStorage.getItem("bb:pr-review:open-review:t1")).toBe(url);
      order.push("navigate");
    });
    expect(order).toEqual(["navigate", "event"]);
  } finally {
    window.removeEventListener("bb:pr-review:open-review", receive);
    sessionStorage.clear();
  }
});
