// Adapted from T3 Code reviewCommentContext.ts. See T3-LICENSE.
import type { FileDiffMetadata, SelectedLineRange, SelectionSide } from "@pierre/diffs";
interface DiffReviewLine {
  change: "context" | "add" | "delete";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}
function stripTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

// File line numbers are 1-based; addition/deletion array indexes are 0-based.
// rowIndex is a 0-based position in the flattened diff: context, deletions, then
// additions. rowRange includes both endpoints and counts rows we skip emitting.
// Example: context old 10/new 10, deletion old 11, addition new 11 occupy rows
// 0, 1, 2. Selecting old 11 through new 11 includes rows 1–2 (both changes).

/** Empty hunks anchor after start; nonempty hunks begin at start itself. */
function firstHunkLine(start: number, count: number): number {
  return start + (count === 0 ? 1 : 0);
}

/** First context line after a hunk, including the empty-hunk anchor adjustment. */
function firstLineAfterHunk(start: number, count: number): number {
  return start + count + (count === 0 ? 1 : 0);
}

function buildDiffReviewLines(
  fileDiff: FileDiffMetadata,
  includeExpandedContext: boolean,
  rowRange?: { readonly startIndex: number; readonly endIndex: number },
): ReadonlyArray<DiffReviewLine> {
  const rows: DiffReviewLine[] = [];
  let rowIndex = 0;
  let oldContextStart = 1;
  let newContextStart = 1;
  const pushRow = (row: DiffReviewLine) => {
    if (!rowRange || (rowIndex >= rowRange.startIndex && rowIndex <= rowRange.endIndex)) {
      rows.push(row);
    }
    rowIndex += 1;
  };
  const pushContextGap = (oldStart: number, newStart: number, lineCount: number) => {
    const count = Math.max(0, lineCount);
    const firstOffset = rowRange ? Math.max(0, rowRange.startIndex - rowIndex) : 0;
    const lastOffset = rowRange ? Math.min(count - 1, rowRange.endIndex - rowIndex) : count - 1;
    for (let offset = firstOffset; offset <= lastOffset; offset += 1) {
      rows.push({
        change: "context",
        oldLineNumber: oldStart + offset,
        newLineNumber: newStart + offset,
        content: stripTrailingNewline(fileDiff.additionLines[newStart + offset - 1] ?? ""),
      });
    }
    rowIndex += count;
  };

  for (const hunk of fileDiff.hunks) {
    if (includeExpandedContext) {
      const oldHunkStart = firstHunkLine(hunk.deletionStart, hunk.deletionCount);
      const newHunkStart = firstHunkLine(hunk.additionStart, hunk.additionCount);
      const contextLines = Math.min(oldHunkStart - oldContextStart, newHunkStart - newContextStart);
      pushContextGap(oldContextStart, newContextStart, contextLines);
    }

    let oldLineNumber = hunk.deletionStart;
    let newLineNumber = hunk.additionStart;
    let deletionLineIndex = hunk.deletionLineIndex;
    let additionLineIndex = hunk.additionLineIndex;

    for (const segment of hunk.hunkContent) {
      if (segment.type === "context") {
        for (let index = 0; index < segment.lines; index += 1) {
          pushRow({
            change: "context",
            oldLineNumber,
            newLineNumber,
            content: stripTrailingNewline(
              fileDiff.additionLines[additionLineIndex] ??
                fileDiff.deletionLines[deletionLineIndex] ??
                "",
            ),
          });
          oldLineNumber += 1;
          newLineNumber += 1;
          deletionLineIndex += 1;
          additionLineIndex += 1;
        }
        continue;
      }

      for (let index = 0; index < segment.deletions; index += 1) {
        pushRow({
          change: "delete",
          oldLineNumber,
          newLineNumber: null,
          content: stripTrailingNewline(fileDiff.deletionLines[deletionLineIndex] ?? ""),
        });
        oldLineNumber += 1;
        deletionLineIndex += 1;
      }

      for (let index = 0; index < segment.additions; index += 1) {
        pushRow({
          change: "add",
          oldLineNumber: null,
          newLineNumber,
          content: stripTrailingNewline(fileDiff.additionLines[additionLineIndex] ?? ""),
        });
        newLineNumber += 1;
        additionLineIndex += 1;
      }
    }

    oldContextStart = firstLineAfterHunk(hunk.deletionStart, hunk.deletionCount);
    newContextStart = firstLineAfterHunk(hunk.additionStart, hunk.additionCount);
  }

  if (includeExpandedContext) {
    const trailingLines = Math.min(
      fileDiff.deletionLines.length - oldContextStart + 1,
      fileDiff.additionLines.length - newContextStart + 1,
    );
    pushContextGap(oldContextStart, newContextStart, trailingLines);
  }

  return rows;
}

function findDiffReviewLineIndex(
  fileDiff: FileDiffMetadata,
  lineNumber: number,
  side: SelectionSide | undefined,
  includeExpandedContext = !fileDiff.isPartial,
): number {
  const findOnSide = (selectedSide: "left" | "right") => {
    let rowIndex = 0;
    let oldContextStart = 1;
    let newContextStart = 1;
    const findContextIndex = (oldStart: number, newStart: number, lineCount: number) => {
      const count = Math.max(0, lineCount);
      const selectedStart = selectedSide === "left" ? oldStart : newStart;
      const offset = lineNumber - selectedStart;
      return offset >= 0 && offset < count ? rowIndex + offset : -1;
    };

    for (const hunk of fileDiff.hunks) {
      if (includeExpandedContext) {
        const oldContextEnd = firstHunkLine(hunk.deletionStart, hunk.deletionCount);
        const newContextEnd = firstHunkLine(hunk.additionStart, hunk.additionCount);
        const contextLines = Math.min(
          oldContextEnd - oldContextStart,
          newContextEnd - newContextStart,
        );
        const contextIndex = findContextIndex(oldContextStart, newContextStart, contextLines);
        if (contextIndex >= 0) return contextIndex;
        rowIndex += Math.max(0, contextLines);
      }

      let oldLineNumber = hunk.deletionStart;
      let newLineNumber = hunk.additionStart;
      for (const segment of hunk.hunkContent) {
        if (segment.type === "context") {
          const contextIndex = findContextIndex(oldLineNumber, newLineNumber, segment.lines);
          if (contextIndex >= 0) return contextIndex;
          rowIndex += segment.lines;
          oldLineNumber += segment.lines;
          newLineNumber += segment.lines;
          continue;
        }

        if (
          selectedSide === "left" &&
          lineNumber >= oldLineNumber &&
          lineNumber < oldLineNumber + segment.deletions
        ) {
          return rowIndex + lineNumber - oldLineNumber;
        }
        rowIndex += segment.deletions;
        oldLineNumber += segment.deletions;

        if (
          selectedSide === "right" &&
          lineNumber >= newLineNumber &&
          lineNumber < newLineNumber + segment.additions
        ) {
          return rowIndex + lineNumber - newLineNumber;
        }
        rowIndex += segment.additions;
        newLineNumber += segment.additions;
      }

      oldContextStart = firstLineAfterHunk(hunk.deletionStart, hunk.deletionCount);
      newContextStart = firstLineAfterHunk(hunk.additionStart, hunk.additionCount);
    }

    if (!includeExpandedContext) return -1;
    const trailingLines = Math.min(
      fileDiff.deletionLines.length - oldContextStart + 1,
      fileDiff.additionLines.length - newContextStart + 1,
    );
    return findContextIndex(oldContextStart, newContextStart, trailingLines);
  };

  const selectedSide = side === "deletions" ? "left" : "right";
  const preferredIndex = findOnSide(selectedSide);
  return preferredIndex >= 0
    ? preferredIndex
    : findOnSide(selectedSide === "left" ? "right" : "left");
}

export function selectedFilePatch(fileDiff: FileDiffMetadata, range: SelectedLineRange) {
  const start = findDiffReviewLineIndex(fileDiff, range.start, range.side);
  const end = findDiffReviewLineIndex(fileDiff, range.end, range.endSide ?? range.side);
  if (start < 0 || end < 0)
    throw new Error("Selection is no longer in this diff. Select the lines again.");
  return buildDiffReviewLines(fileDiff, !fileDiff.isPartial, {
    startIndex: Math.min(start, end),
    endIndex: Math.max(start, end),
  })
    .map(
      (row) => `${row.change === "add" ? "+" : row.change === "delete" ? "-" : " "}${row.content}`,
    )
    .join("\n");
}
