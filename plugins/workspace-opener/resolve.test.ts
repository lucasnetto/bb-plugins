import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveWorkspace } from "./resolve.ts";

void test("resolves one direct workspace and preserves ambiguous, ordinary, and file paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-opener-"));
  try {
    assert.equal(await resolveWorkspace(root), null);
    const workspace = join(root, "180seg.code-workspace");
    await writeFile(workspace, '{"folders":[]}');
    assert.equal(await resolveWorkspace(root), workspace);
    assert.equal(await resolveWorkspace(workspace), null);
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "other.code-workspace"), "{}");
    assert.equal(await resolveWorkspace(root), workspace);
    await writeFile(join(root, "second.code-workspace"), "{}");
    assert.equal(await resolveWorkspace(root), null);
    await rm(join(root, "second.code-workspace"));
    await mkdir(join(root, "directory.code-workspace"));
    assert.equal(await resolveWorkspace(root), workspace);
    await rm(workspace);
    await symlink(join(root, "nested", "other.code-workspace"), workspace);
    assert.equal(await resolveWorkspace(root), workspace);
    assert.equal(await resolveWorkspace(join(root, "missing")), null);
    assert.equal(await resolveWorkspace("relative"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
