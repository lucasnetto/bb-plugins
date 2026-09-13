import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, stat, utimes, symlink, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { cachedSkillArchive } from "../task-skills.ts";
import { overlap } from "../task-concurrency.ts";
import { reconnectDaemon } from "../task-resume.ts";

void test("skills archive is reused and invalidates for edits, additions, removals and symlink targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "orbisa-archive-test-"));

  const home = join(root, "home"),
    cache = join(root, "cache");

  const signal = new AbortController().signal;

  try {
    const skills = join(home, ".agents/skills");
    await mkdir(skills, { recursive: true });
    const file = join(skills, "SKILL.md");
    await writeFile(file, "first");
    const first = await cachedSkillArchive(home, signal, cache);
    const archiveStat = await stat(first.archive!);
    const second = await cachedSkillArchive(home, signal, cache);
    assert.equal(second.digest, first.digest);
    assert.equal((await stat(second.archive!)).ino, archiveStat.ino);
    assert.equal((await stat(second.archive!)).mtimeMs, archiveStat.mtimeMs);
    // Malformed persisted metadata is a cache miss, not a startup failure.
    await writeFile(join(cache, "receipt.json"), JSON.stringify({ digest: 123 }));
    const recovered = await cachedSkillArchive(home, signal, cache);
    assert.equal(recovered.digest, first.digest);
    const original = await stat(file);
    await writeFile(file, "other");
    await utimes(file, original.atime, original.mtime);
    const edited = await cachedSkillArchive(home, signal, cache);
    assert.notEqual(edited.digest, first.digest);
    await utimes(file, new Date(), new Date());
    assert.equal((await cachedSkillArchive(home, signal, cache)).digest, edited.digest);
    await writeFile(join(root, "linked"), "target1");
    const link = join(skills, "linked.md");
    await symlink(join(root, "linked"), link);
    const added = await cachedSkillArchive(home, signal, cache);
    assert.notEqual(added.digest, edited.digest);
    await writeFile(join(root, "replacement"), "target2");
    await unlink(link);
    await symlink(join(root, "replacement"), link);
    assert.notEqual((await cachedSkillArchive(home, signal, cache)).digest, added.digest);
    await unlink(link);
    assert.equal((await cachedSkillArchive(home, signal, cache)).digest, edited.digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("boot and credentials overlap and failures drain the other branch", async () => {
  let release!: () => void;
  const started: string[] = [];

  const work = overlap(
    new AbortController().signal,
    async () => {
      started.push("boot");
      await new Promise<void>((resolve) => {
        release = resolve;
      });

      return 1;
    },
    async () => {
      started.push("credentials");

      return "ready";
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["boot", "credentials"]);
  release();
  assert.deepEqual(await work, [1, "ready"]);
  const failure = new Error("credential failure");
  let drained = false;

  const failed = overlap(
    new AbortController().signal,
    async (signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      drained = true;
    },
    async () => {
      throw failure;
    },
  );

  await assert.rejects(failed, (error) => error === failure);
  assert.ok(drained);
});

void test("daemon resume confirms connection, falls back on missing/broken service, and respects cancellation", async () => {
  const signal = new AbortController().signal;
  assert.equal(
    await reconnectDaemon({ signal, start: async () => true, connected: async () => true }),
    true,
  );
  assert.equal(
    await reconnectDaemon({
      signal,
      start: async () => false,
      connected: async () => {
        throw new Error("should not poll");
      },
    }),
    false,
  );
  assert.equal(
    await reconnectDaemon({
      signal,
      start: async () => true,
      connected: async () => false,
      timeoutMs: 0,
    }),
    false,
  );
  assert.equal(
    await reconnectDaemon({
      signal,
      start: async () => {
        throw new Error("service unavailable");
      },
      connected: async () => false,
    }),
    false,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    reconnectDaemon({
      signal: controller.signal,
      start: async () => true,
      connected: async () => true,
    }),
    { name: "AbortError" },
  );
});

void test("scheduled cache maintenance expires caches without a task launch", async () => {
  const { createFakePluginHost } = await import("@get-bb/plugin-sdk/testing");
  const { registerTaskMaintenance } = await import("../task-maintenance.ts");
  const { bb, harness } = createFakePluginHost({ pluginId: "orbisa" });

  try {
    const expired = join(dirname(bb.storage.database().name), "git-cache", "a".repeat(64));
    await mkdir(expired, { recursive: true });
    await writeFile(join(expired, "last-used"), "1");
    registerTaskMaintenance(bb, "a".repeat(10), {
      get: async () => undefined,
      set: async () => {},
    });
    await harness.behavior.runSchedule("task-cache-maintenance");
    await assert.rejects(stat(expired), { code: "ENOENT" });
  } finally {
    await harness.lifecycle.dispose();
  }
});

void test("daemon fast path only clears suspension for the matching installation", async () => {
  const { START_DAEMON_SCRIPT } = await import("../task-vms.ts");
  const { checked } = await import("../task-process.ts");
  const { realpath, readFile } = await import("node:fs/promises");
  const root = await realpath(await mkdtemp(join(tmpdir(), "orbisa-daemon-test-")));
  const data = join(root, ".bb-machines/orbisa");
  const units = join(root, ".config/systemd/user");
  const host = "host_test";

  try {
    await mkdir(data, { recursive: true });
    await mkdir(units, { recursive: true });
    await writeFile(join(data, "host-id"), "host_other");
    await writeFile(join(data, "machine-suspended"), "");
    await writeFile(
      join(units, `bb-host-daemon-example-${host}.service`),
      `Environment="BB_DATA_DIR=${data}"`,
    );

    const script =
      String.raw`
import pathlib,subprocess,sys,types,json
pathlib.Path.home=classmethod(lambda cls:pathlib.Path(sys.argv[2]))
def record(args,**kwargs):
    with open(pathlib.Path.home()/'calls','a') as f: f.write(json.dumps(args)+'\n')
    return types.SimpleNamespace(returncode=0)
subprocess.run=record
` + START_DAEMON_SCRIPT;

    const signal = new AbortController().signal;
    await assert.rejects(checked(["python3", "-c", script, host, root], { signal }));
    assert.ok((await stat(join(data, "machine-suspended"))).isFile());
    await writeFile(join(data, "host-id"), host);
    await checked(["python3", "-c", script, host, root], { signal });
    await assert.rejects(stat(join(data, "machine-suspended")), { code: "ENOENT" });

    const calls = (await readFile(join(root, "calls"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.deepEqual(
      calls.map((args) => args[2]),
      ["reset-failed", "start"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
