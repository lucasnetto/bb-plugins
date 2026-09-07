import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { parseDiffFromFile } from "@pierre/diffs";
import { selectedFilePatch } from "../../../src/ui/review/expandedSelection";
test("expanded unchanged lines can be quoted before and after the patch", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}\n`);
  const oldFile = { name: "file.ts", contents: lines.join("") };
  const next = [...lines];
  next[20] = "changed\n";
  const diff = parseDiffFromFile(oldFile, { name: "file.ts", contents: next.join("") });
  assert.equal(
    selectedFilePatch(diff, { start: 2, end: 4, side: "additions" }),
    " line 2\n line 3\n line 4",
  );
  assert.equal(
    selectedFilePatch(diff, { start: 39, end: 38, side: "deletions" }),
    " line 38\n line 39",
  );
});

test("expanded selections preserve added and deleted files with empty opposite sides", () => {
  const added = parseDiffFromFile(null, { name: "new.ts", contents: "first\nsecond\n" });
  assert.equal(
    selectedFilePatch(added, { start: 1, end: 2, side: "additions" }),
    "+first\n+second",
  );
  const deleted = parseDiffFromFile({ name: "old.ts", contents: "first\nsecond\n" }, null);
  assert.equal(
    selectedFilePatch(deleted, { start: 2, end: 1, side: "deletions" }),
    "-first\n-second",
  );
});
