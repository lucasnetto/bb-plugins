import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Effect } from "effect";
import {
  pullCleanDefaultBranch as pull,
  pullGitLive,
} from "../../../src/server/lib/project-auto-pull";

const pullCleanDefaultBranch = (path) =>
  Effect.runPromise(pull(path).pipe(Effect.provide(pullGitLive)));

test("auto-pull fast-forwards only clean default checkouts without local commits", async () => {
  const root = await mkdtemp(join(tmpdir(), "t3-pull-"));

  const remote = join(root, "remote.git"),
    writer = join(root, "writer"),
    checkout = join(root, "checkout");

  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  try {
    git(root, "init", "--bare", "--initial-branch=main", remote);
    git(root, "clone", remote, writer);
    git(writer, "config", "user.name", "Test");
    git(writer, "config", "user.email", "test@example.com");
    await writeFile(join(writer, "file"), "one");
    git(writer, "add", ".");
    git(writer, "commit", "-m", "one");
    git(writer, "push", "-u", "origin", "main");
    git(root, "clone", remote, checkout);
    git(checkout, "config", "user.name", "Test");
    git(checkout, "config", "user.email", "test@example.com");
    await writeFile(join(writer, "file"), "two");
    git(writer, "commit", "-am", "two");
    git(writer, "push");
    await writeFile(join(checkout, "untracked"), "dirty");
    assert.deepEqual(await pullCleanDefaultBranch(checkout), { pulled: false });
    await rm(join(checkout, "untracked"));
    git(checkout, "checkout", "-b", "feature");
    assert.deepEqual(await pullCleanDefaultBranch(checkout), { pulled: false });
    git(checkout, "checkout", "main");
    assert.deepEqual(await pullCleanDefaultBranch(checkout), { pulled: true });
    assert.equal(git(checkout, "rev-parse", "HEAD"), git(writer, "rev-parse", "HEAD"));
    await writeFile(join(checkout, "local"), "ahead");
    git(checkout, "add", ".");
    git(checkout, "commit", "-m", "local");
    assert.deepEqual(await pullCleanDefaultBranch(checkout), { pulled: false });
    assert.deepEqual(await pullCleanDefaultBranch(root), { pulled: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
