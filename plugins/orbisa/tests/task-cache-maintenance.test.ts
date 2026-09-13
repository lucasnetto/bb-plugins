import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { skillArchiveFingerprint } from "../task-skills.ts";
import { checked } from "../task-process.ts";
import { prunePreparedBases, type CachedBase } from "../task-base-retention.ts";
import { pruneGitCaches, withGitBundle } from "../task-git-cache.ts";
import { timed } from "../task-timing.ts";

const signal = new AbortController().signal;

void test("skill content hash ignores metadata and order, resolves hardlinks, and tracks content and permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "orbisa-skills-test-"));

  try {
    async function fingerprint(version: number) {
      const path = join(root, `${version}.tar`);
      await checked(
        [
          "python3",
          "-c",
          String.raw`
import io,sys,tarfile
version=int(sys.argv[2])
with tarfile.open(sys.argv[1],'w') as tar:
    names=['a','b'] if version==0 else ['b','a']
    for name in names:
        e=tarfile.TarInfo(name); e.mode=0o755 if version==3 else 0o644
        e.mtime=version*100; e.uid=version; e.gid=version
        content=b'changed' if version==2 else b'original'
        if version==4 and name=='a':
            e.type=tarfile.LNKTYPE; e.linkname='b'; tar.addfile(e)
        else:
            e.size=len(content); tar.addfile(e,io.BytesIO(content))
`,
          path,
          String(version),
        ],
        { signal },
      );

      return skillArchiveFingerprint(path, signal);
    }

    const original = await fingerprint(0);
    assert.equal(await fingerprint(1), original);
    assert.equal(await fingerprint(4), original);
    assert.notEqual(await fingerprint(2), original);
    assert.notEqual(await fingerprint(3), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("base retention preserves current, fallback, running, replaced and foreign machines", async () => {
  const owner = "a".repeat(10);
  const now = 100 * 24 * 60 * 60_000;

  const make = (i: number): CachedBase => ({
    name: `orbisa-base-${owner}-${String(i).padStart(16, "0")}`,
    id: `vm${i}`,
    state: "stopped",
    config: { isolated: true, isolate_network: true, forward_ssh_agent: false, mounts: [] },
  });

  const vms = Array.from({ length: 8 }, (_, i) => make(i));
  vms[3]!.state = "running";
  vms[5]!.name = "cursor-base";
  vms[6]!.config.mounts = ["mac"];
  const used = new Map(vms.map((v, i) => [v.name, i === 1 ? now - 1 : 1]));
  used.delete(vms[7]!.name);
  const deleted: string[] = [];
  let reads = 0;
  await prunePreparedBases({
    owner,
    current: vms[0]!.name,
    now,
    receipts: {
      get: async (name) => vms.find((v) => v.name === name)?.id,
      set: async () => {},
      lastUsed: async (name) => used.get(name),
      touch: async (name, at) => {
        used.set(name, at);
      },
    },
    list: async () => {
      reads++;

      return vms.map((v) => (v.id === "vm4" && reads > 1 ? { ...v, id: "replacement" } : v));
    },
    remove: async (vm) => {
      deleted.push(vm.id);
    },
  });
  assert.deepEqual(deleted, ["vm2"]);
  assert.equal(used.get(vms[7]!.name), now);
});

void test("Git retention skips active transfers, recent caches, symlinks and unknown directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "orbisa-retention-test-"));
  const cache = join(root, "cache");
  const now = Date.now();

  try {
    await mkdir(cache);

    for (const [name, used] of [
      ["a".repeat(64), 1],
      ["b".repeat(64), now],
      ["unknown", 1],
    ] as const) {
      await mkdir(join(cache, name));
      await writeFile(join(cache, name, "last-used"), String(used));
    }

    await symlink(join(cache, "unknown"), join(cache, "c".repeat(64)));
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

    await git("init", "-b", "main", source);
    await writeFile(join(source, "file"), "data");
    await git("-C", source, "add", ".");
    await git("-C", source, "commit", "-m", "initial");
    let active = "";
    await withGitBundle(cache, source, signal, async (bundle) => {
      active = dirname(bundle);
      await writeFile(join(active, "last-used"), "1");
      await pruneGitCaches(cache, signal, now);
      assert.ok((await stat(bundle)).isFile());
      // Restore the actual use time before the post-transfer sweep.
      await writeFile(join(active, "last-used"), String(now));
    });
    await assert.rejects(stat(join(cache, "a".repeat(64))), { code: "ENOENT" });
    assert.equal(await readFile(join(cache, "unknown/last-used"), "utf8"), "1");
    assert.ok((await stat(join(cache, "b".repeat(64)))).isDirectory());
    await writeFile(join(active, "last-used"), "1");
    await pruneGitCaches(cache, signal, now);
    await assert.rejects(stat(active), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("timings record failure without exposing the error or changing its identity", async () => {
  const reports: string[] = [];
  const error = new Error("sensitive output");
  await assert.rejects(
    timed(
      (text) => reports.push(text),
      "Enrollment",
      async () => {
        throw error;
      },
    ),
    (e) => e === error,
  );
  assert.match(reports[0]!, /^Timing: Enrollment: \d+ms \(failed\)$/);
});
