import { test, expect } from "vite-plus/test";
import { Effect } from "effect";
import { linkedSummary } from "../../src/server/links-host";
import { runHost } from "../../src/server/host-effects";
import { hostContract } from "../../src/shared/contract";

test("host RPC validates safe positive PR numbers and strips extra fields", async () => {
  const validate = hostContract.prFiles.input["~standard"].validate;
  expect(await validate({ root: "/repo", repo: "api", number: 42, extra: true })).toEqual({
    value: { root: "/repo", repo: "api", number: 42 },
  });
  for (const number of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect((await validate({ root: "/repo", repo: "api", number })).issues).toBeDefined();
  }
});

test("malformed GitHub JSON and payloads remain typed input failures", async () => {
  for (const payload of [
    "{broken",
    JSON.stringify({ title: 42 }),
    JSON.stringify({
      title: "PR",
      state: "OPEN",
      isDraft: false,
      body: "",
      headRefName: "fix",
      baseRefName: "main",
      baseRefOid: "base",
      headRefOid: null,
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
