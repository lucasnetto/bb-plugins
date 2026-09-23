import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localCheckoutDiff,
  localDiff,
  localSnapshot,
  parseStatus,
} from "../../src/local-changes/git";

let root: string;

const git = (path: string, ...args: string[]) =>
  execFileSync("git", ["-C", path, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

async function repo(name = "repo") {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  git(path, "init", "-b", "main");
  git(path, "config", "user.name", "Local Changes Test");
  git(path, "config", "user.email", "test@example.com");
  await writeFile(join(path, "file.txt"), "original\n");
  git(path, "add", ".");
  git(path, "commit", "-m", "Initial");

  return path;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "bb-local-changes-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("discovers nested repos and outside worktrees, preferring the thread checkout", async () => {
  const project = join(root, "project");
  const path = await repo("project/service");
  const worktree = join(root, "outside worktree");
  git(path, "worktree", "add", "-b", "feature", worktree);
  await writeFile(join(worktree, "file.txt"), "worktree change\n");
  const result = await localSnapshot(project);
  expect(result.checkouts).toHaveLength(2);
  expect(result.checkouts.find((item) => item.branch === "feature")?.changes).toEqual([
    { path: "file.txt", status: "M", area: "unstaged", previousPath: undefined },
  ]);
  const selected = await localSnapshot(worktree);
  expect(selected.checkouts.find((item) => item.current)?.branch).toBe("feature");
  expect(selected.checkouts.filter((item) => item.current)).toHaveLength(1);

  const diff = await localDiff(project, {
    checkout: result.checkouts.find((item) => item.branch === "feature")!.path,
    path: "file.txt",
    area: "unstaged",
  });

  expect(diff.patch).toContain("+worktree change");
});

it("separates index changes from working-tree edits and includes untracked files", async () => {
  const path = await repo();
  await writeFile(join(path, "file.txt"), "staged\n");
  git(path, "add", ".");
  await writeFile(join(path, "file.txt"), "unstaged\n");
  await writeFile(join(path, "new file.txt"), "new file\n");
  const snapshot = await localSnapshot(path);
  const checkout = snapshot.checkouts[0].path;
  const combined = await localDiff(path, { checkout, path: "file.txt", area: "combined" });
  expect(combined.patch).toContain("-original\n+unstaged");
  expect(combined.patch).not.toContain("+staged");
  expect(snapshot.checkouts[0].changes.map((item) => item.area)).toEqual([
    "staged",
    "unstaged",
    "untracked",
  ]);
  expect((await localDiff(path, { checkout, path: "file.txt", area: "staged" })).patch).toContain(
    "+staged",
  );
  expect((await localDiff(path, { checkout, path: "file.txt", area: "unstaged" })).patch).toContain(
    "-staged\n+unstaged",
  );
  expect(
    (await localDiff(path, { checkout, path: "new file.txt", area: "untracked" })).patch,
  ).toContain("+new file");
  await expect(
    localDiff(path, { checkout: root, path: "file.txt", area: "unstaged" }),
  ).rejects.toThrow("no longer belongs");
  expect(
    (await localDiff(path, { checkout, path: "../outside", area: "untracked" })).notice,
  ).toContain("no longer has changes");
});

it("handles renames, newline filenames, deletion, and literal pathspec characters", async () => {
  const path = await repo();
  git(path, "mv", "file.txt", "renamed\nfile.txt");
  await writeFile(join(path, "[x].txt"), "literal\n");
  const snapshot = await localSnapshot(path);
  const checkout = snapshot.checkouts[0].path;
  expect(snapshot.checkouts[0].changes).toContainEqual({
    path: "renamed\nfile.txt",
    previousPath: "file.txt",
    status: "R",
    area: "staged",
  });
  expect(
    (await localDiff(path, { checkout, path: "renamed\nfile.txt", area: "staged" })).patch,
  ).toContain("rename from file.txt");
  expect((await localDiff(path, { checkout, path: "[x].txt", area: "untracked" })).patch).toContain(
    "+literal",
  );
  git(path, "commit", "-am", "Rename");
  await rm(join(path, "renamed\nfile.txt"));
  expect(
    (await localDiff(path, { checkout, path: "renamed\nfile.txt", area: "unstaged" })).patch,
  ).toContain("-original");
});

it("handles unborn repositories, binary and oversized files, and symlinks", async () => {
  const path = join(root, "unborn");
  await mkdir(path);
  git(path, "init", "-b", "main");
  await writeFile(join(path, "new.txt"), "first\n");
  git(path, "add", ".");
  await writeFile(join(path, "binary"), Buffer.from([0, 1, 2]));
  await writeFile(join(path, "large"), "x".repeat(1024 * 1024 + 1));
  await symlink("/does/not/exist", join(path, "link"));
  const checkout = (await localSnapshot(path)).checkouts[0].path;
  expect((await localDiff(path, { checkout, path: "new.txt", area: "staged" })).patch).toContain(
    "+first",
  );
  await writeFile(join(path, "new.txt"), "working version\n");
  expect((await localDiff(path, { checkout, path: "new.txt", area: "combined" })).patch).toContain(
    "+working version",
  );
  expect((await localDiff(path, { checkout, path: "binary", area: "untracked" })).notice).toContain(
    "Binary",
  );
  expect((await localDiff(path, { checkout, path: "large", area: "untracked" })).notice).toContain(
    "too large",
  );
  expect((await localDiff(path, { checkout, path: "link", area: "untracked" })).patch).toContain(
    "+/does/not/exist",
  );
});

it("reports clean and non-Git directories honestly and ignores dependency folders", async () => {
  expect((await localSnapshot(root)).checkouts).toEqual([]);
  await repo();
  await repo("node_modules/ignored");
  const result = await localSnapshot(root);
  expect(result.checkouts).toHaveLength(1);
  expect(result.checkouts[0].changes).toEqual([]);
});

it("parses conflicts as one entry", () => {
  expect(parseStatus("UU file.txt\0?? new\nfile\0")).toEqual([
    { path: "file.txt", status: "UU", area: "conflict" },
    { path: "new\nfile", status: "?", area: "untracked" },
  ]);
});

it("batches every changed file once and keeps binary notices beside readable diffs", async () => {
  const path = await repo();
  await writeFile(join(path, "file.txt"), "staged\n");
  git(path, "add", ".");
  await writeFile(join(path, "file.txt"), "working\n");
  await writeFile(join(path, "new.txt"), "new\n");
  await writeFile(join(path, "binary"), Buffer.from([0, 1, 2]));
  const checkout = (await localSnapshot(path)).checkouts[0].path;
  const files = await localCheckoutDiff(path, checkout);
  expect(files).toHaveLength(3);
  expect(files.find((file) => file.path === "file.txt")?.patch).toContain("-original\n+working");
  expect(files.find((file) => file.path === "new.txt")?.patch).toContain("+new");
  expect(files.find((file) => file.path === "binary")?.notice).toContain("Binary");
  await expect(localCheckoutDiff(path, root)).rejects.toThrow("no longer belongs");
});

it("reuses discovery without caching file contents or allowing workspaces from another root", async () => {
  const project = join(root, "project");
  const path = await repo("project/service");
  const outside = await repo("outside");
  const checkout = (await localSnapshot(project)).checkouts[0].path;
  const unrelated = (await localSnapshot(outside)).checkouts[0].path;
  await writeFile(join(path, "file.txt"), "first edit\n");
  expect((await localCheckoutDiff(project, checkout))[0].patch).toContain("+first edit");
  await writeFile(join(path, "file.txt"), "second edit\n");
  expect((await localCheckoutDiff(project, checkout))[0].patch).toContain("+second edit");
  await expect(localCheckoutDiff(project, unrelated)).rejects.toThrow("no longer belongs");
  const worktree = join(root, "new-worktree");
  git(path, "worktree", "add", "-b", "new-feature", worktree);
  await writeFile(join(worktree, "file.txt"), "new worktree\n");
  // Use the canonical path without another discovery pass, as a just-created worktree would.
  const { realpath } = await import("node:fs/promises");
  expect((await localCheckoutDiff(project, await realpath(worktree)))[0].patch).toContain(
    "+new worktree",
  );
});
