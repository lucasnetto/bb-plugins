import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { parseDiffFromFile, parsePatchFiles } from "@pierre/diffs";
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

test("selections across separate hunks preserve context and old/new ordering in either direction", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}\n`);
  const changed = [...lines];
  changed[2] = "first change\n";
  changed[35] = "last change\n";
  const diff = parseDiffFromFile(
    { name: "file.ts", contents: lines.join("") },
    { name: "file.ts", contents: changed.join("") },
  );
  assert.ok(diff.hunks.length > 1);
  const expected = [
    "-line 3",
    "+first change",
    ...lines.slice(3, 35).map((line) => ` ${line.trimEnd()}`),
    "-line 36",
    "+last change",
  ].join("\n");
  assert.equal(
    selectedFilePatch(diff, { start: 3, side: "deletions", end: 36, endSide: "additions" }),
    expected,
  );
  assert.equal(
    selectedFilePatch(diff, { start: 36, side: "additions", end: 3, endSide: "deletions" }),
    expected,
  );
});

test("a small selection in a large unchanged gap does not scan the whole file", () => {
  const lines = Array.from({ length: 10_000 }, (_, index) => `line ${index + 1}\n`);
  const changed = [...lines];
  changed[0] = "changed\n";
  const diff = parseDiffFromFile(
    { name: "file.ts", contents: lines.join("") },
    { name: "file.ts", contents: changed.join("") },
  );
  let reads = 0;
  diff.additionLines = new Proxy(diff.additionLines, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(
    selectedFilePatch(diff, { start: 9000, end: 9001, side: "additions" }),
    " line 9000\n line 9001",
  );
  assert.ok(reads < 20, `Expected bounded content reads, received ${reads}`);
});

test("partial diffs omit unavailable gaps and reject endpoints outside their hunks", () => {
  const [patch] = parsePatchFiles(
    [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -10,2 +10,2 @@",
      "-old first",
      "+new first",
      " context first",
      "@@ -30,2 +30,2 @@",
      " context last",
      "-old last",
      "+new last",
      "",
    ].join("\n"),
  );
  const diff = patch.files[0];
  assert.equal(diff.isPartial, true);
  assert.equal(
    selectedFilePatch(diff, { start: 10, side: "deletions", end: 31, endSide: "additions" }),
    "-old first\n+new first\n context first\n context last\n-old last\n+new last",
  );
  assert.throws(
    () => selectedFilePatch(diff, { start: 20, end: 30, side: "additions" }),
    /no longer in this diff/,
  );
});

test("selection falls back to the other side when the requested side has no matching line", () => {
  const diff = parseDiffFromFile(null, { name: "new.ts", contents: "first\nsecond\n" });
  assert.equal(selectedFilePatch(diff, { start: 1, end: 2, side: "deletions" }), "+first\n+second");
});
