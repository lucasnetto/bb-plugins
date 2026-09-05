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
