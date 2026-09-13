import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { linkedContents as contentsEffect } from "../../src/server/links-host";
import { runHost, type Command } from "../../src/server/host-effects";

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

function linkedContents(
  root: string,
  input: Parameters<typeof contentsEffect>[1],
  signal?: AbortSignal,
  run?: Command,
) {
  return runHost(contentsEffect(root, input), signal, run);
}
