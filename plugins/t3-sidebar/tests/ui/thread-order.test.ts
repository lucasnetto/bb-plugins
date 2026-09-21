import { expect, test } from "vite-plus/test";
import { applyThreadOrder, moveThread } from "../../src/ui/lib/thread-order";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

test("manual order survives activity changes and new threads lead", () => {
  expect(applyThreadOrder(rows("new", "a", "b", "c"), ["c", "a", "b"]).map((t) => t.id)).toEqual([
    "new",
    "c",
    "a",
    "b",
  ]);
  expect(applyThreadOrder(rows("b", "a", "c"), ["c", "a", "b"]).map((t) => t.id)).toEqual([
    "c",
    "a",
    "b",
  ]);
});

test("filtered moves preserve hidden slots and support both insertion edges", () => {
  expect(moveThread(["a", "hidden", "b", "c"], ["a", "b", "c"], "c", "a", false)).toEqual([
    "c",
    "hidden",
    "a",
    "b",
  ]);
  expect(moveThread(["a", "hidden", "b", "c"], ["a", "b", "c"], "a", "c", true)).toEqual([
    "b",
    "hidden",
    "c",
    "a",
  ]);
  expect(moveThread(["a", "b"], ["a", "b"], "missing", "b", true)).toEqual(["a", "b"]);
});
