// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { requestLinkedReview } from "../../../src/ui/lib/multirepo-navigation";

test("sidebar stores the review before navigation and signals after navigation", () => {
  const url = "https://github.com/org/api/pull/42";
  const order: string[] = [];
  const receive = () => order.push("event");
  window.addEventListener("bb:multirepo:open-review", receive);
  try {
    requestLinkedReview("t1", url, (threadId) => {
      expect(threadId).toBe("t1");
      expect(sessionStorage.getItem("bb:multirepo:open-review:t1")).toBe(url);
      order.push("navigate");
    });
    expect(order).toEqual(["navigate", "event"]);
  } finally {
    window.removeEventListener("bb:multirepo:open-review", receive);
    sessionStorage.clear();
  }
});
