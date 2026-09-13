import { selectedFilePatch } from "./expandedSelection";
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type { LinkedDetail } from "../../shared/links-contract";

// Preserve patch order so selections spanning old/new columns or dragged upward
// quote exactly the rows between the two endpoints.
export function selectedPatch(patch: string, range: SelectedLineRange) {
  const rows: { old: number | null; next: number | null; text: string }[] = [];

  let old = 0,
    next = 0,
    inHunk = false;

  for (const text of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);

    if (hunk) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      inHunk = true;
      continue;
    }

    if (!inHunk || ![" ", "+", "-"].includes(text[0] ?? "")) continue;
    rows.push({ old: text[0] === "+" ? null : old++, next: text[0] === "-" ? null : next++, text });
  }

  const startSide = range.side === "deletions" ? "old" : "next";
  const endSide = (range.endSide ?? range.side) === "deletions" ? "old" : "next";
  const start = rows.findIndex((row) => row[startSide] === range.start);
  const end = rows.findIndex((row) => row[endSide] === range.end);

  if (start < 0 || end < 0)
    throw new Error("Selection is no longer in this diff. Select the lines again.");

  return rows
    .slice(Math.min(start, end), Math.max(start, end) + 1)
    .map((row) => row.text)
    .join("\n");
}

// Instructions stay in the editable composer; the chip contains only source context.
export function reviewContext(
  detail: LinkedDetail,
  path: string | null,
  range?: SelectedLineRange,
  fullDiff?: FileDiffMetadata,
) {
  const file = detail.files.find((file) => file.path === path);
  const side = (value: string | undefined) => (value === "deletions" ? "old" : "new");

  const code =
    range && file?.patch
      ? fullDiff
        ? selectedFilePatch(fullDiff, range)
        : selectedPatch(file.patch, range)
      : null;

  const fence = "`".repeat(
    Math.max(3, ...Array.from(code?.matchAll(/`+/g) ?? [], (match) => match[0].length + 1)),
  );

  return [
    `PR: ${detail.pr.url}`,
    path ? `File: ${JSON.stringify(path)}` : "",
    detail.headRefOid ? `Head: ${detail.headRefOid}` : "",
    detail.baseRefOid ? `Base: ${detail.baseRefOid}` : "",
    range
      ? `Lines: ${side(range.side)} ${range.start}–${side(range.endSide ?? range.side)} ${range.end}`
      : "",
    code !== null ? `${fence}diff\n${code}\n${fence}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
