import type { SelectedLineRange } from "@pierre/diffs";
import type { GithubReviewAction } from "../../shared/github-review-contract";

type GithubSelection = Pick<
  Extract<GithubReviewAction, { kind: "add" }>,
  "side" | "line" | "startLine" | "startSide"
>;

export function githubSelection(range: SelectedLineRange) {
  const side: "LEFT" | "RIGHT" = range.side === "deletions" ? "LEFT" : "RIGHT";
  const endSide = (range.endSide ?? range.side) === "deletions" ? "LEFT" : "RIGHT";

  if (side !== endSide)
    throw new Error("Select lines on one side of the diff to add a GitHub comment.");
  const start = Math.min(range.start, range.end);
  const line = Math.max(range.start, range.end);

  const selection: GithubSelection = { side, line };

  if (start === line) return selection;

  return { ...selection, startLine: start, startSide: side };
}
