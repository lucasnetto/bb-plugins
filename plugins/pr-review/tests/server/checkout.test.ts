import { test, expect } from "vite-plus/test";
import { githubRemote, matchingCheckout } from "../../src/server/checkout";
import { runHost } from "../../src/server/host-effects";

test("checkout matching supports GitHub remotes and only reads the current checkout", async () => {
  for (const remote of [
    "git@github.com:Org/Repo.git",
    "https://github.com/org/repo.git",
    "ssh://git@github.com/org/repo.git",
  ])
    expect(githubRemote(remote)).toBe("org/repo");
  expect(githubRemote("https://example.com/org/repo.git")).toBeNull();
  const calls: string[][] = [];
  const path = await runHost(
    matchingCheckout("/repo/subdir", "org/repo"),
    undefined,
    async (cwd, program, args) => {
      expect(cwd).toBe("/repo/subdir");
      expect(program).toBe("git");
      calls.push(args);
      return args.includes("remote") ? "git@github.com:org/repo.git" : "/repo\n";
    },
  );
  expect(path).toBe("/repo");
  expect(calls).toEqual([
    ["--no-pager", "remote", "get-url", "origin"],
    ["--no-pager", "rev-parse", "--show-toplevel"],
  ]);
});

test("a different checkout or unavailable Git still allows a GitHub-only review", async () => {
  let reads = 0;
  expect(
    await runHost(matchingCheckout("/repo", "org/repo"), undefined, async () => {
      reads++;
      return "git@github.com:org/other.git";
    }),
  ).toBeNull();
  expect(reads).toBe(1);
  expect(
    await runHost(matchingCheckout("/home", "org/repo"), undefined, async () => {
      throw new Error("Not a Git repository");
    }),
  ).toBeNull();
});
