// Adapted from T3 Code reviewCommentContext.ts. See T3-LICENSE.
import type { FileDiffMetadata, SelectedLineRange, SelectionSide } from "@pierre/diffs";

/** A contiguous run of rows, without allocating the individual file lines. */
interface DiffReviewSegment {
  change: "context" | "add" | "delete";
  rowStart: number;
  count: number;
  oldStart: number | null;
  newStart: number | null;
  deletionIndex: number | null;
  additionIndex: number | null;
}

function stripTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

// File line numbers are 1-based; content indexes and flattened row positions are
// 0-based. Within a change, deletions precede additions. A selection from old 11
// to new 11 therefore includes both rows, even though the line numbers match.

/** Empty hunks anchor after start; nonempty hunks begin at start itself. */
function firstHunkLine(start: number, count: number): number {
  return start + (count === 0 ? 1 : 0);
}

function firstLineAfterHunk(start: number, count: number): number {
  return firstHunkLine(start, count) + count;
}

/** Shared ordering and coordinates for endpoint lookup and selected text extraction. */
function diffReviewSegments(fileDiff: FileDiffMetadata): DiffReviewSegment[] {
  const segments: DiffReviewSegment[] = [];
  let rowIndex = 0;
  let oldContextStart = 1;
  let newContextStart = 1;
  const append = (segment: Omit<DiffReviewSegment, "rowStart">) => {
    segments.push({ ...segment, rowStart: rowIndex });
    rowIndex += segment.count;
  };
  const appendContextGap = (count: number) => {
    append({
      change: "context",
      count: Math.max(0, count),
      oldStart: oldContextStart,
      newStart: newContextStart,
      // Expanded gaps read the new file only; hunk context can fall back to the old file.
      deletionIndex: null,
      additionIndex: newContextStart - 1,
    });
  };

  for (const hunk of fileDiff.hunks) {
    if (!fileDiff.isPartial) {
      appendContextGap(
        Math.min(
          firstHunkLine(hunk.deletionStart, hunk.deletionCount) - oldContextStart,
          firstHunkLine(hunk.additionStart, hunk.additionCount) - newContextStart,
        ),
      );
    }
    let oldLineNumber = hunk.deletionStart;
    let newLineNumber = hunk.additionStart;
    let deletionIndex = hunk.deletionLineIndex;
    let additionIndex = hunk.additionLineIndex;
    for (const segment of hunk.hunkContent) {
      if (segment.type === "context") {
        append({
          change: "context",
          count: segment.lines,
          oldStart: oldLineNumber,
          newStart: newLineNumber,
          deletionIndex,
          additionIndex,
        });
        oldLineNumber += segment.lines;
        newLineNumber += segment.lines;
        deletionIndex += segment.lines;
        additionIndex += segment.lines;
      } else {
        append({
          change: "delete",
          count: segment.deletions,
          oldStart: oldLineNumber,
          newStart: null,
          deletionIndex,
          additionIndex: null,
        });
        append({
          change: "add",
          count: segment.additions,
          oldStart: null,
          newStart: newLineNumber,
          deletionIndex: null,
          additionIndex,
        });
        oldLineNumber += segment.deletions;
        newLineNumber += segment.additions;
        deletionIndex += segment.deletions;
        additionIndex += segment.additions;
      }
    }
    oldContextStart = firstLineAfterHunk(hunk.deletionStart, hunk.deletionCount);
    newContextStart = firstLineAfterHunk(hunk.additionStart, hunk.additionCount);
  }
  if (!fileDiff.isPartial) {
    appendContextGap(
      Math.min(
        fileDiff.deletionLines.length - oldContextStart + 1,
        fileDiff.additionLines.length - newContextStart + 1,
      ),
    );
  }
  return segments;
}

function findReviewRowIndex(
  segments: readonly DiffReviewSegment[],
  lineNumber: number,
  side: SelectionSide | undefined,
): number {
  const findOnSide = (coordinate: "oldStart" | "newStart") => {
    for (const segment of segments) {
      const start = segment[coordinate];
      if (start !== null && lineNumber >= start && lineNumber < start + segment.count) {
        return segment.rowStart + lineNumber - start;
      }
    }
    return -1;
  };
  const coordinate = side === "deletions" ? "oldStart" : "newStart";
  const preferredIndex = findOnSide(coordinate);
  return preferredIndex >= 0
    ? preferredIndex
    : findOnSide(coordinate === "oldStart" ? "newStart" : "oldStart");
}

export function selectedFilePatch(fileDiff: FileDiffMetadata, range: SelectedLineRange) {
  const segments = diffReviewSegments(fileDiff);
  const start = findReviewRowIndex(segments, range.start, range.side);
  const end = findReviewRowIndex(segments, range.end, range.endSide ?? range.side);
  if (start < 0 || end < 0)
    throw new Error("Selection is no longer in this diff. Select the lines again.");

  const firstRow = Math.min(start, end);
  const lastRow = Math.max(start, end);
  const rows: string[] = [];
  for (const segment of segments) {
    const firstOffset = Math.max(0, firstRow - segment.rowStart);
    const lastOffset = Math.min(segment.count - 1, lastRow - segment.rowStart);
    const prefix = segment.change === "add" ? "+" : segment.change === "delete" ? "-" : " ";
    // Read only selected rows, including when a small selection is inside a large context gap.
    for (let offset = firstOffset; offset <= lastOffset; offset += 1) {
      const addition =
        segment.additionIndex === null
          ? undefined
          : fileDiff.additionLines[segment.additionIndex + offset];
      const deletion =
        segment.deletionIndex === null
          ? undefined
          : fileDiff.deletionLines[segment.deletionIndex + offset];
      rows.push(prefix + stripTrailingNewline(addition ?? deletion ?? ""));
    }
  }
  return rows.join("\n");
}
