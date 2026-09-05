import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  command,
  discover,
  repository,
  changes,
  files,
  detail,
  githubRemote,
} from "./git";

test("discovers nested repos and worktrees; separates changes and preserves unusual paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "multirepo-"));
  try {
    const repo = join(root, "services", "api");
    await mkdir(repo, { recursive: true });
    const git = (...args: string[]) => command(repo, "git", args);
    await git("init", "-b", "main");
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.com");
    await writeFile(join(repo, "old name.txt"), "one\ntwo\n");
    await writeFile(join(repo, "mixed.txt"), "base\n");
    await git("add", ".");
    await git("commit", "-m", "initial");
    await git("worktree", "add", join(root, "review"), "-b", "review");
    await git("mv", "old name.txt", "new name.txt");
    await writeFile(join(repo, "mixed.txt"), "staged\n");
    await git("add", "mixed.txt");
    await writeFile(join(repo, "mixed.txt"), "working\n");
    await writeFile(join(repo, "new\nfile.txt"), "untracked\n");
    const found = await discover(root);
    assert.deepEqual(
      found.map((r) => r.name),
      ["review", "services/api"],
    );
    assert.equal(found[0].changes, 0);
    assert.equal(found[1].changes, 3);
    const status = await changes(repo);
    assert.equal(
      status.find((c) => c.path === "new name.txt")?.oldPath,
      "old name.txt",
    );
    assert.equal(status.find((c) => c.path === "mixed.txt")?.index, "M");
    assert.equal(status.find((c) => c.path === "mixed.txt")?.worktree, "M");
    assert.ok((await files(repo)).includes("new\nfile.txt"));
    assert.match(
      (await detail(repo, "mixed.txt", "staged")).patch!,
      /\+staged/,
    );
    assert.match(
      (await detail(repo, "mixed.txt", "worktree")).patch!,
      /\+working/,
    );
    assert.equal(
      (await detail(repo, "new\nfile.txt", "source")).content,
      "untracked\n",
    );
    await assert.rejects(repository(root, "../escape"), /Invalid/);
    const outside = join(root, "outside.txt");
    await writeFile(outside, "secret");
    await symlink(outside, join(repo, "outside-link"));
    await assert.rejects(detail(repo, "outside-link", "source"), /outside/);
    await writeFile(join(repo, "binary"), Buffer.from([0, 1, 2]));
    assert.equal((await detail(repo, "binary", "source")).content, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("only recognizes GitHub origins, with SSH and HTTPS support", () => {
  assert.equal(githubRemote("git@github.com:180seg/api.git"), "180seg/api");
  assert.equal(githubRemote("https://github.com/180seg/api.git"), "180seg/api");
  assert.equal(
    githubRemote("ssh://git@github.com/180seg/api.git"),
    "180seg/api",
  );
  assert.equal(githubRemote("https://evil.example/180seg/api"), null);
});
