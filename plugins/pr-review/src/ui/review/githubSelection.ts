import type { SelectedLineRange } from "@pierre/diffs";
export function githubSelection(range: SelectedLineRange) {
  const side: "LEFT" | "RIGHT" = range.side === "deletions" ? "LEFT" : "RIGHT";
  const endSide = (range.endSide ?? range.side) === "deletions" ? "LEFT" : "RIGHT";
  if (side !== endSide)
    throw new Error("Select lines on one side of the diff to add a GitHub comment.");
  const start = Math.min(range.start, range.end);
  const line = Math.max(range.start, range.end);
  return {
    side,
    line,
    ...(start === line ? {} : { startLine: start, startSide: side as "LEFT" | "RIGHT" }),
  } as const;
}
