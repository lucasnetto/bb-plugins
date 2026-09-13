import { describe, expect, test } from "vite-plus/test";
import { Effect } from "effect";
import { cloudRunSummary, githubRepository, readCloudSource } from "../../src/server/cloud.js";
import { SdkError } from "../../src/server/operations.js";

const ref = "a".repeat(40);
const tip = "b".repeat(40);
function checkout(overrides: Record<string, string | null> = {}) {
  const responses: Record<string, string | null> = {
    "status --porcelain --untracked-files=normal": "",
    "remote get-url origin": "git@github.com:example/repo.git",
    "rev-parse HEAD": ref,
    "ls-remote --heads origin": `${ref}\trefs/heads/main`,
    ...overrides,
  };
  return (_cwd: string, args: string[]) => {
    const value = responses[args.join(" ")];
    return typeof value === "string"
      ? Effect.succeed(value)
      : Effect.fail(new SdkError({ message: "Git failed" }));
  };
}

describe("cloud repository source", () => {
  test.each([
    "git@github.com:example/repo.git",
    "ssh://git@github.com/example/repo.git",
    "https://github.com/example/repo/",
    "github.com/example/repo",
  ])("normalizes %s", (remote) => {
    expect(githubRepository(remote)).toBe("https://github.com/example/repo");
  });
  test.each([
    "https://secret@github.com/example/repo",
    "https://github.com.evil/example/repo",
    "git@gitlab.com:example/repo.git",
    "https://github.com/example/..",
  ])("rejects unsupported or unsafe remote %s", (remote) => {
    expect(() => githubRepository(remote)).toThrow();
  });
  test("pins a clean, pushed commit", async () => {
    expect(await Effect.runPromise(readCloudSource("/checkout", checkout()))).toEqual({
      repository: "https://github.com/example/repo",
      ref,
    });
  });
  test.each<Record<string, string>>([
    { "remote get-url origin": "https://secret@github.com/example/repo" },
    {
      "rev-parse HEAD": "invalid-sha",
      "ls-remote --heads origin": `${tip}\trefs/heads/main`,
      [`merge-base --is-ancestor invalid-sha ${tip}`]: "",
    },
  ])("keeps invalid Git output in the typed error channel", async (overrides) => {
    const result = await Effect.runPromise(
      readCloudSource("/checkout", checkout(overrides)).pipe(
        Effect.catchTag("SdkError", (error) => Effect.succeed(error)),
      ),
    );
    expect(result).toBeInstanceOf(SdkError);
    expect(JSON.stringify(result)).not.toContain("secret@");
  });
  test("accepts an ancestor already reachable from an origin branch", async () => {
    const git = checkout({
      "ls-remote --heads origin": `${tip}\trefs/heads/main`,
      [`merge-base --is-ancestor ${ref} ${tip}`]: "",
    });
    expect((await Effect.runPromise(readCloudSource("/checkout", git))).ref).toBe(ref);
  });
  test("rejects a dirty tree or unpushed commit", async () => {
    await expect(
      Effect.runPromise(
        readCloudSource(
          "/checkout",
          checkout({ "status --porcelain --untracked-files=normal": " M file" }),
        ),
      ),
    ).rejects.toThrow("Commit or stash");
    await expect(
      Effect.runPromise(
        readCloudSource(
          "/checkout",
          checkout({ "ls-remote --heads origin": `${tip}\trefs/heads/main` }),
        ),
      ),
    ).rejects.toThrow("Push this commit");
  });
  test("does not invent links or render unsafe branch URLs", () => {
    const summary = cloudRunSummary("bc-test", undefined, {
      id: "run",
      status: "finished",
      git: {
        branches: [
          {
            repoUrl: "github.com/example/repo",
            branch: "cursor/a)b",
            prUrl: "https://github.com/example/repo/pull/12",
          },
          { repoUrl: "https://evil.example/repo", branch: "bad", prUrl: "https://evil.example/pr" },
        ],
      },
    });
    expect(summary).toContain("https://cursor.com/agents/bc-test");
    expect(summary).toContain("/tree/cursor%2Fa%29b");
    expect(summary).toContain("/pull/12");
    expect(summary).not.toContain("evil.example");
    expect(() => cloudRunSummary("../bad")).toThrow();
  });
});

test("does not append an empty branch summary after the answer", () => {
  expect(
    cloudRunSummary("bc-test", undefined, {
      id: "run",
      status: "finished",
      git: { branches: [{ repoUrl: "github.com/example/repo" }] },
    }),
  ).toBe("");
});
