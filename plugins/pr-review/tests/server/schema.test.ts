import { test, expect } from "vite-plus/test";
import { Effect } from "effect";
import { linkedSummary } from "../../src/server/links-host";
import { runHost } from "../../src/server/host-effects";

test("malformed GitHub JSON and payloads remain typed input failures", async () => {
  for (const payload of [
    "{broken",
    JSON.stringify({ title: 42 }),
    JSON.stringify({
      title: "PR",
      state: "open",
      merged: false,
      draft: false,
      body: "",
      head: { ref: "fix", sha: null },
      base: { ref: "main", sha: "base" },
    }),
  ]) {
    const result = await runHost(
      linkedSummary("/repo", "https://github.com/org/api/pull/42").pipe(
        Effect.map(() => "unexpected success"),
        Effect.catchTag("InputError", (error) => Effect.succeed(error._tag)),
      ),
      undefined,
      async () => payload,
    );

    expect(result).toBe("InputError");
  }
});

test("guide job responses require the fields guaranteed by each lifecycle stage", async () => {
  const { rpcContract } = await import("../../src/shared/contract");
  const validate = rpcContract.guideJob.output["~standard"].validate;
  const identity = { id: "job", threadId: "t1", url: "https://github.com/org/api/pull/42" };
  expect(await validate({ ...identity, status: "preparing" })).toEqual({
    value: { ...identity, status: "preparing" },
  });

  const running = {
    ...identity,
    status: "running",
    workerId: "worker",
    base: "a".repeat(40),
    head: "b".repeat(40),
  };

  expect(await validate(running)).toEqual({ value: running });

  for (const invalid of [
    { ...running, workerId: null },
    { ...running, base: "" },
    { ...running, head: undefined },
    { ...identity, status: "error", workerId: null, revision: null, error: "" },
  ])
    expect((await validate(invalid)).issues).toBeDefined();
});

for (const [state, merged, expected] of [
  ["open", false, "OPEN"],
  ["closed", false, "CLOSED"],
  ["closed", true, "MERGED"],
] as const) {
  test(`reads ${expected} PR metadata without CLI JSON field dependencies`, async () => {
    const result = await runHost(
      linkedSummary("/repo", "https://github.com/org/api/pull/42"),
      undefined,
      async (_cwd, program, args) => {
        expect(program).toBe("gh");
        expect(args).toEqual(["api", "--hostname", "github.com", "repos/org/api/pulls/42"]);

        return JSON.stringify({
          title: "PR",
          state,
          merged,
          draft: true,
          body: null,
          head: { ref: "fix", sha: "b".repeat(40) },
          base: { ref: "main", sha: "a".repeat(40) },
        });
      },
    );

    expect(result.state).toBe(expected);
    expect(result.isDraft).toBe(true);
  });
}
