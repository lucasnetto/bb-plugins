import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, symlink, writeFile, readFile, rm, stat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checked } from "../task-process.ts";
import { normalizeRemote, withGitBundle } from "../task-git-cache.ts";
import { CHECKOUT_SCRIPT, REMOVE_SCRIPT, checkoutPath } from "../task-checkout.ts";
import { discoverCatalog } from "../task-catalog.ts";

void test("checkout rejects credential-bearing and executable remotes", () => {
  assert.equal(
    normalizeRemote("git@github.com:owner/repo.git"),
    "https://github.com/owner/repo.git",
  );
  assert.equal(
    normalizeRemote("ssh://git@github.com/owner/repo.git"),
    "https://github.com/owner/repo.git",
  );
  for (const remote of [
    "-u",
    "file:///tmp/repo",
    "ext::bad",
    "https://token@github.com/a/b",
    "https://github.com/a/b?token=x",
  ])
    assert.throws(() => normalizeRemote(remote));
  assert.throws(() => checkoutPath("../bad", "key"));
  assert.notEqual(checkoutPath("tester", "a"), checkoutPath("tester", "b"));
});

void test("catalog preserves nested repos, skips duplicate origins and worktrees, and seeds originless commits", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orbisa-catalog-test-")));
  const signal = new AbortController().signal;
  const catalog = join(root, "catalog");
  const git = (...args: string[]) =>
    checked(
      [
        "git",
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { signal },
    );
  try {
    for (const name of ["a", "duplicate", "nested/local"]) {
      const repo = join(catalog, name);
      await git("init", "-b", "feature", repo);
      await writeFile(join(repo, "file"), "committed");
      await git("-C", repo, "add", ".");
      await git("-C", repo, "commit", "-m", "seed");
      if (name !== "nested/local")
        await git("-C", repo, "remote", "add", "origin", "git@github.com:example/repo.git");
    }
    await mkdir(join(catalog, "linked"));
    await writeFile(join(catalog, "linked/.git"), "gitdir: elsewhere");
    await symlink(join(catalog, "a"), join(catalog, "symlink"));
    const repos = await discoverCatalog(catalog, signal);
    assert.deepEqual(
      repos.map(({ relative }) => relative),
      ["a", "nested/local"],
    );
    const local = repos[1]!;
    await writeFile(join(local.source, "file"), "uncommitted");
    const path = join(root, "guest/local");
    await withGitBundle(
      join(root, "cache"),
      local.source,
      signal,
      async (bundle, defaultBranch) => {
        await checked(
          [
            "python3",
            "-c",
            CHECKOUT_SCRIPT,
            JSON.stringify({ path, remote: local.remote, key: "local", defaultBranch }),
          ],
          { signal, stdinFile: bundle },
        );
      },
    );
    assert.equal(await readFile(join(path, "file"), "utf8"), "committed");
    assert.equal((await git("-C", path, "branch", "--show-current")).trim(), "feature");
    assert.equal((await git("-C", path, "remote")).trim(), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("cached bundles refresh upstream changes, clone independent branches, and preserve retry edits", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orbisa-checkout-test-")));
  const signal = new AbortController().signal;
  const source = join(root, "source");
  const git = (...args: string[]) =>
    checked(
      [
        "git",
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { signal },
    );
  try {
    await git("init", "-b", "main", source);
    await writeFile(join(source, "file.txt"), "one");
    await git("-C", source, "add", ".");
    await git("-C", source, "commit", "-m", "initial");
    const revision1 = (await git("-C", source, "rev-parse", "HEAD")).trim();
    const checkout = join(root, "checkout");
    const input = {
      path: checkout,
      remote: "https://github.com/example/repo.git",
      key: "task",
      branch: { kind: "new", baseBranch: "origin/main" },
      suggestedBranch: "task/test",
    };
    let firstMtime = 0;
    await withGitBundle(join(root, "cache"), source, signal, async (bundle, defaultBranch) => {
      firstMtime = (await stat(bundle)).mtimeMs;
      await checked(
        ["python3", "-c", CHECKOUT_SCRIPT, JSON.stringify({ ...input, defaultBranch })],
        { signal, stdinFile: bundle },
      );
    });
    assert.equal((await git("-C", checkout, "branch", "--show-current")).trim(), "task/test");
    assert.equal((await git("-C", checkout, "rev-parse", "HEAD")).trim(), revision1);
    await writeFile(join(checkout, "file.txt"), "dirty work");
    await withGitBundle(join(root, "cache"), source, signal, async (bundle, defaultBranch) => {
      assert.equal((await stat(bundle)).mtimeMs, firstMtime);
      await checked(
        ["python3", "-c", CHECKOUT_SCRIPT, JSON.stringify({ ...input, defaultBranch })],
        { signal, stdinFile: bundle },
      );
    });
    assert.equal(await readFile(join(checkout, "file.txt"), "utf8"), "dirty work");
    await writeFile(join(source, "file.txt"), "two");
    await git("-C", source, "commit", "-am", "update");
    const revision2 = (await git("-C", source, "rev-parse", "HEAD")).trim();
    const second = join(root, "second");
    await withGitBundle(join(root, "cache"), source, signal, async (bundle, defaultBranch) => {
      await checked(
        [
          "python3",
          "-c",
          CHECKOUT_SCRIPT,
          JSON.stringify({
            ...input,
            path: second,
            key: "task2",
            branch: undefined,
            defaultBranch,
          }),
        ],
        { signal, stdinFile: bundle },
      );
    });
    await rm(join(root, "cache"), { recursive: true, force: true });
    assert.equal((await git("-C", second, "rev-parse", "HEAD")).trim(), revision2);
    assert.equal((await git("-C", checkout, "rev-parse", "HEAD")).trim(), revision1);
    await assert.rejects(stat(join(checkout, ".git/objects/info/alternates")), { code: "ENOENT" });
    await checked(["python3", "-c", REMOVE_SCRIPT, checkout], { signal });
    await checked(["python3", "-c", REMOVE_SCRIPT, checkout], { signal });
    await assert.rejects(stat(checkout), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
