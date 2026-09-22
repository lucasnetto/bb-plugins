import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect } from "vite-plus/test";
import { editorTarget, parseWorktrees } from "../../src/server/editor-target";
import { runHost } from "../../src/server/host-effects";

test("finds a branch worktree beneath a grouping project and falls back to the original checkout", async () => {
  const group = await mkdtemp(join(tmpdir(), "pr-editor-"));
  const repo = join(group, "repo");
  const tree = join(group, "branch with spaces");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  try {
    git("init", "-b", "main");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    );
    git("remote", "add", "origin", "git@github.com:org/repo.git");
    git("worktree", "add", "-b", "feature/test", tree);
    // Git canonicalizes macOS /var to /private/var.
    const canonicalTree = execFileSync("git", ["-C", tree, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const canonicalRepo = execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    expect(await runHost(editorTarget([group], "org/repo", "feature/test"))).toBe(canonicalTree);
    expect(await runHost(editorTarget([tree], "org/repo", "missing"))).toBe(canonicalRepo);
    await rm(tree, { recursive: true });
    expect(await runHost(editorTarget([repo], "org/repo", "feature/test"))).toBe(canonicalRepo);
    await expect(runHost(editorTarget([group], "org/other", "main"))).rejects.toThrow(
      "No local checkout",
    );
  } finally {
    await rm(group, { recursive: true, force: true });
  }
});

test("parses exact branch refs and unusual paths without selecting prunable or bare entries", () => {
  expect(
    parseWorktrees(
      "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /a\n雪\0HEAD abc\0branch refs/heads/feature\0\0worktree /gone\0prunable missing\0\0worktree /bare\0bare\0\0",
    ),
  ).toEqual([
    { path: "/repo", branch: "refs/heads/main" },
    { path: "/a\n雪", branch: "refs/heads/feature" },
  ]);
});
