import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Effect } from "effect";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "../../../src/server/host";
import { registerProjectAutoPull } from "../../../src/server/lib/project-settings";
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

test("discovery finds grouped checkouts and respects repository boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "t3-discover-"));
  const host = experimental_createHostEntryHarness(hostEntry);
  const discover = (path) => host.experimental_call("discover", { path });

  try {
    for (const path of [
      "direct/.git",
      "direct/submodule/.git",
      "group/deeper/repo/.git",
      ".worktrees/hidden/.git",
      "node_modules/dependency/.git",
      "vendor/dependency/.git",
      "target/generated/.git",
      "dist/generated/.git",
      "build/generated/.git",
      "bare/objects",
      "bare/refs",
      "bare/unexpected/.git",
      "empty",
    ])
      await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, "bare/HEAD"), "ref: refs/heads/main\n");
    await mkdir(join(root, "worktree"));
    await writeFile(join(root, "worktree/.git"), "gitdir: /external/gitdir\n");
    await symlink(join(root, "direct"), join(root, "alias"));
    await symlink(root, join(root, "group/loop"));

    assert.deepEqual(await discover(root), {
      paths: ["direct", "group/deeper/repo", "worktree"].map((path) => join(root, path)),
      errors: [],
    });
    assert.deepEqual(await discover(join(root, "direct")), {
      paths: [join(root, "direct")],
      errors: [],
    });
    assert.deepEqual(await discover(join(root, "worktree")), {
      paths: [join(root, "worktree")],
      errors: [],
    });
    assert.deepEqual(await discover(join(root, "direct/submodule")), {
      paths: [join(root, "direct/submodule")],
      errors: [],
    });
    assert.deepEqual(await discover(join(root, "empty")), { paths: [], errors: [] });
    const missing = await discover(join(root, "missing"));
    assert.deepEqual(missing.paths, []);
    assert.equal(missing.errors[0].path, join(root, "missing"));
    assert.match(missing.errors[0].message, /ENOENT/);
  } finally {
    await host.experimental_dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "scheduled auto-pull updates clean nested repositories while skipping dirty and feature checkouts",
  { timeout: 20_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "t3-group-pull-"));
    const project = join(root, "180seg");
    const remote = join(root, "remote.git");
    const writer = join(root, "writer");
    const host = experimental_createHostEntryHarness(hostEntry);

    const { bb, harness } = createFakePluginHost({
      pluginId: "t3-sidebar",
      sdk: {
        hosts: { list: async () => [{ id: "online", status: "connected" }] },
        projects: {
          list: async () => [
            { id: "group", name: "180seg", sources: [{ hostId: "online", path: project }] },
          ],
        },
      },
      experimental_callHostRpc: ({ method, input, signal }) =>
        host.experimental_call(method, input, { signal }),
    });

    const git = (cwd, ...args) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();

    try {
      await mkdir(project);
      await mkdir(join(project, "group"));
      git(root, "init", "--bare", "--initial-branch=main", remote);
      git(root, "clone", remote, writer);
      git(writer, "config", "user.name", "Test");
      git(writer, "config", "user.email", "test@example.com");
      await writeFile(join(writer, "file"), "one");
      git(writer, "add", ".");
      git(writer, "commit", "-m", "one");
      git(writer, "push", "-u", "origin", "main");
      const before = git(writer, "rev-parse", "HEAD");

      for (const path of ["clean", "dirty", "feature", "group/clean"])
        git(root, "clone", remote, join(project, path));
      // Keep a default-branch linked worktree inside the group, with its owner elsewhere.
      const owner = join(root, "worktree-owner");
      git(root, "clone", remote, owner);
      git(owner, "checkout", "--detach");
      git(owner, "worktree", "add", join(project, "group/worktree"), "main");
      await writeFile(join(project, "dirty/local"), "local change");
      git(join(project, "feature"), "checkout", "-b", "feature");
      await writeFile(join(writer, "file"), "two");
      git(writer, "commit", "-am", "two");
      git(writer, "push");
      const after = git(writer, "rev-parse", "HEAD");

      registerProjectAutoPull(bb);
      await bb.storage.kv.set("project-settings:group", { autoPull: true });
      await harness.behavior.runSchedule("project-auto-pull");

      for (const path of ["clean", "group/clean", "group/worktree"])
        assert.equal(git(join(project, path), "rev-parse", "HEAD"), after);

      for (const path of ["dirty", "feature"])
        assert.equal(git(join(project, path), "rev-parse", "HEAD"), before);
      assert.equal(git(join(project, "feature"), "branch", "--show-current"), "feature");
      assert.equal(git(join(project, "dirty"), "status", "--porcelain"), "?? local");
      assert.equal(harness.logEntries.filter((entry) => entry.level === "warn").length, 0);
    } finally {
      await harness.lifecycle.dispose();
      await host.experimental_dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
