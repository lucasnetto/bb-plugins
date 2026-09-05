import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { parseDiffFromFile } from "@pierre/diffs";
import { linkedContents } from "../links-host";
import { selectedFilePatch } from "./expandedSelection";
const base = "a".repeat(40),
  head = "b".repeat(40),
  merge = "c".repeat(40);
const input = {
  url: "https://github.com/org/api/pull/9",
  base,
  head,
  path: "new folder/file.ts",
  oldPath: "old folder/file.ts",
  changeType: "rename-changed" as const,
};
test("context reads merge-base and pinned head contents, including renamed paths", async () => {
  const calls: string[] = [];
  const output = await linkedContents("/parent", input, undefined, async (root, program, args) => {
    assert.equal(root, "/parent");
    assert.equal(program, "gh");
    const route = args.at(-1)!;
    calls.push(route);
    if (route.includes("/compare/")) return JSON.stringify({ merge_base_commit: { sha: merge } });
    return route.includes(`ref=${head}`) ? "new\n" : "old\n";
  });
  assert.deepEqual(output, { oldContents: "old\n", newContents: "new\n" });
  assert.ok(calls.includes(`repos/org/api/contents/old%20folder/file.ts?ref=${merge}`));
  assert.ok(calls.includes(`repos/org/api/contents/new%20folder/file.ts?ref=${head}`));
});
test("added/deleted files skip the absent side and propagate load failures", async () => {
  for (const changeType of ["new", "deleted"] as const) {
    let reads = 0;
    const result = await linkedContents(
      "/parent",
      { ...input, changeType },
      undefined,
      async (_root, _program, args) => {
        if (args.at(-1)!.includes("/compare/"))
          return JSON.stringify({ merge_base_commit: { sha: merge } });
        reads++;
        return "contents\n";
      },
    );
    assert.equal(reads, 1);
    assert.equal(changeType === "new" ? result.oldContents : result.newContents, "");
  }
  await assert.rejects(
    () =>
      linkedContents("/parent", input, undefined, async () => {
        throw new Error("offline");
      }),
    /offline/,
  );
});
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
