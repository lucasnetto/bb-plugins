import { expect, test } from "vite-plus/test";
import { linkedDetail, linkedSummary } from "../../src/server/links-host";
import { runHost } from "../../src/server/host-effects";

const file = {
  filename: "a.ts",
  status: "modified",
  patch: '@@ -1 +1 @@\n-before\n+after "quoted" \\ text',
};

test.each([true, false])("preserves GitHub completion timestamps (merged=%s)", async (merged) => {
  const timestamp = "2026-09-15T12:00:00Z";

  const pr = await runHost(
    linkedSummary("/repo", "https://github.com/org/api/pull/9"),
    undefined,
    async () =>
      JSON.stringify({
        title: "PR",
        state: "closed",
        merged,
        draft: false,
        body: "",
        merged_at: merged ? timestamp : null,
        closed_at: timestamp,
        head: { ref: "fix", sha: "b".repeat(40) },
        base: { ref: "main", sha: "a".repeat(40) },
      }),
  );

  expect(pr.state).toBe(merged ? "MERGED" : "CLOSED");
  expect(pr.mergedAt).toBe(merged ? timestamp : null);
  expect(pr.closedAt).toBe(timestamp);
});

for (const pages of [[[], [file], [{ ...file, filename: "b.ts" }]], [[]]]) {
  test(`loads ${pages.flat().length} files across compact JSON pages`, async () => {
    const detail = await runHost(
      linkedDetail("/repo", "https://github.com/org/api/pull/9"),
      undefined,
      async (_cwd, program, args) => {
        if (program === "git") return "git@github.com:other/repo.git";

        if (args.at(-1) === "repos/org/api/pulls/9")
          return JSON.stringify({
            title: "PR",
            state: "open",
            merged: false,
            draft: false,
            body: "",
            head: { ref: "fix", sha: "b".repeat(40) },
            base: { ref: "main", sha: "a".repeat(40) },
          });
        expect(args).not.toContain("--slurp");
        expect(args).toContain("--paginate");
        expect(args[args.indexOf("--jq") + 1]).toBe("@json");

        return `${pages.map((page) => JSON.stringify(page)).join("\n")}\n`;
      },
    );

    expect(detail.baseRefOid).toBe("a".repeat(40));
    expect(detail.headRefOid).toBe("b".repeat(40));
    expect(detail.files).toEqual(
      pages.flat().map((entry) => ({
        path: entry.filename,
        status: entry.status,
        patch: entry.patch,
      })),
    );
  });
}

test("rejects malformed paginated data", async () => {
  await expect(
    runHost(
      linkedDetail("/repo", "https://github.com/org/api/pull/9"),
      undefined,
      async (_cwd, program, args) => {
        if (program === "git") return "git@github.com:other/repo.git";

        if (args.at(-1) === "repos/org/api/pulls/9")
          return JSON.stringify({
            title: "PR",
            state: "open",
            merged: false,
            draft: false,
            body: "",
            head: { ref: "fix", sha: "b".repeat(40) },
            base: { ref: "main", sha: "a".repeat(40) },
          });

        return '[{"filename":42}]\n';
      },
    ),
  ).rejects.toThrow();
});
