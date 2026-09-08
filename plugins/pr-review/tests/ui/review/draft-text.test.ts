import { expect, test } from "vite-plus/test";
import { buildReviewDraftText } from "../../../src/ui/review/reviewDraftText";

test("review actions preserve instructions, target scope, and comment whitespace", () => {
  expect(buildReviewDraftText("Ask", "this PR", "")).toBe("Review this PR.");
  expect(buildReviewDraftText("Explain", "this file", " \n ")).toBe("Explain this file.");
  expect(buildReviewDraftText("Fix", "this code", "  Keep the API.\nKeep spacing.  ")).toBe(
    "Fix this code.\nKeep the API.\nKeep spacing.",
  );
  expect(buildReviewDraftText("Comment", "this code", "  Just my comment.  ")).toBe(
    "Just my comment.",
  );
  expect(buildReviewDraftText("Comment", "this PR", " \n ")).toBe("");
});
