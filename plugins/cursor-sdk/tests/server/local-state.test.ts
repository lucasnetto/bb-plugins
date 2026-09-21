import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { Deferred, Effect } from "effect";
import { JsonlLocalAgentStore } from "@cursor/sdk";
import { afterEach, expect, test } from "vite-plus/test";
import { acquireLocalLease, coordinatedLocalStore } from "../../src/server/local-state.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory() {
  const path = mkdtempSync(join(tmpdir(), "cursor-local-state-"));
  directories.push(path);

  return path;
}

// Run the actual coordination implementation in independent Node processes.
function childModule(root: string) {
  for (const name of ["operations", "local-state"]) {
    const source = readFileSync(new URL(`../../src/server/${name}.ts`, import.meta.url), "utf8");

    const javascript = stripTypeScriptTypes(source)
      .replace('from "effect"', `from ${JSON.stringify(import.meta.resolve("effect"))}`)
      .replace('from "zod"', `from ${JSON.stringify(import.meta.resolve("zod"))}`);

    writeFileSync(
      join(root, `${name}.mjs`),
      javascript.replace('"./operations.js"', '"./operations.mjs"'),
    );
  }

  return pathToFileURL(join(root, "local-state.mjs")).href;
}

test("a live owner excludes other sessions; release is idempotent and cannot evict a successor", () => {
  const root = directory();
  const release = acquireLocalLease(root, "agent:one");
  expect(() => acquireLocalLease(root, "agent:one")).toThrow("live process");
  const other = acquireLocalLease(root, "agent:two");
  other();
  release();
  const successor = acquireLocalLease(root, "agent:one");
  release();
  expect(() => acquireLocalLease(root, "agent:one")).toThrow("live process");
  successor();
});

test("recovers ownership only after the recorded process exits", async () => {
  const root = directory();
  acquireLocalLease(root, "agent:one")();

  const moduleUrl = childModule(root);

  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import { acquireLocalLease } from ${JSON.stringify(moduleUrl)};
    acquireLocalLease(${JSON.stringify(root)}, "agent:one");
    process.send("ready");
    setInterval(() => {}, 1000);
  `,
    ],
    {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );

  try {
    await once(child, "message");
    expect(child.pid).toBeDefined();
    expect(() => acquireLocalLease(root, "agent:one")).toThrow("live process");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const release = acquireLocalLease(root, "agent:one");
    expect(() => acquireLocalLease(root, "agent:one")).toThrow("live process");
    release();
  } finally {
    child.kill("SIGKILL");
  }
});

test("store operations hold the shared lock until asynchronous writes finish", async () => {
  const root = directory();
  const raw = new JsonlLocalAgentStore(root);
  const first = coordinatedLocalStore(raw, root);
  const second = coordinatedLocalStore(new JsonlLocalAgentStore(root), root);

  const agent = {
    agentId: "one",
    cwd: "/tmp",
    status: "idle" as const,
    createdAt: 1,
    updatedAt: 1,
  };

  const create = raw.agents.create.bind(raw.agents);
  const entered = Deferred.makeUnsafe<void>();
  const finish = Deferred.makeUnsafe<void>();
  raw.agents.create = async (input) => {
    await Effect.runPromise(Deferred.succeed(entered, undefined));
    await Effect.runPromise(Deferred.await(finish));

    return create(input);
  };

  const writing = first.agents.create({ agent });
  await Effect.runPromise(Deferred.await(entered));
  expect(() => acquireLocalLease(root, "store")).toThrow("live process");
  const next = second.agents.create({ agent: { ...agent, agentId: "two" } });
  await Effect.runPromise(Deferred.succeed(finish, undefined));
  await Promise.all([writing, next]);
  expect((await second.agents.list()).items.map((a) => a.agentId).sort()).toEqual(["one", "two"]);
});

test("store failures release the lock", async () => {
  const root = directory();
  const store = coordinatedLocalStore(new JsonlLocalAgentStore(root), root);

  const agent = {
    agentId: "one",
    cwd: "/tmp",
    status: "idle" as const,
    createdAt: 1,
    updatedAt: 1,
  };

  await store.agents.create({ agent });
  await expect(store.agents.create({ agent })).rejects.toThrow();
  expect(await store.agents.get({ agentId: "one" })).toEqual(agent);
  acquireLocalLease(root, "store")();
});

test("a late checkpoint write cannot resurrect a cancelled run or its active pointer", async () => {
  const root = directory();
  const store = coordinatedLocalStore(new JsonlLocalAgentStore(root), root);

  const agent = {
    agentId: "one",
    cwd: "/tmp",
    status: "running" as const,
    activeRunId: "run-one",
    createdAt: 1,
    updatedAt: 1,
    latestCheckpoint: { schemaVersion: 1 as const, rootBlobId: "root" },
    sdkMetadata: { opaque: "preserved" },
  };

  const run = {
    agentId: "one",
    runId: "run-one",
    turnNumber: 1,
    status: "running" as const,
    createdAt: 1,
    updatedAt: 1,
  };

  await store.agents.create({ agent });
  await store.runs.create({ run });
  const cancelled = { ...run, status: "cancelled" as const, updatedAt: 2, endedAt: 2 };
  await store.runs.update({ run: cancelled });
  await store.agents.update({ agent: { ...agent, status: "idle", activeRunId: null } });
  // These snapshots were read before cancellation completed.
  await store.runs.update({ run });
  await store.agents.update({ agent });
  expect(await store.runs.get({ agentId: "one", runId: "run-one" })).toEqual(cancelled);
  expect(await store.agents.get({ agentId: "one" })).toEqual({
    ...agent,
    status: "idle",
    activeRunId: null,
  });
});

test("independent session processes preserve concurrent JSONL writes", async () => {
  const root = directory();
  const moduleUrl = childModule(root);
  const sdkUrl = import.meta.resolve("@cursor/sdk");

  const children = [0, 1, 2].map((index) =>
    spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
    import { coordinatedLocalStore } from ${JSON.stringify(moduleUrl)};
    import { JsonlLocalAgentStore } from ${JSON.stringify(sdkUrl)};
    const root = ${JSON.stringify(root)};
    const store = coordinatedLocalStore(new JsonlLocalAgentStore(root), root);
    process.on("message", async () => {
      for (let i = 0; i < 8; i++) {
        const agentId = "agent-${index}-" + i;
        await store.agents.create({ agent: { agentId, cwd: "/tmp", status: "idle", createdAt: 1, updatedAt: 1 } });
        await store.agents.update({ agent: { agentId, cwd: "/tmp", status: "idle", createdAt: 1, updatedAt: 2 } });
      }
      process.exit(0);
    });
    process.send("ready");
  `,
      ],
      { stdio: ["ignore", "ignore", "inherit", "ipc"] },
    ),
  );

  try {
    await Promise.all(children.map((child) => once(child, "message")));
    const exits = children.map((child) => once(child, "exit"));

    for (const child of children) child.send("go");

    for (const [code] of await Promise.all(exits)) expect(code).toBe(0);
    const store = new JsonlLocalAgentStore(root);
    const records = (await store.agents.list({ filter: { limit: 100 } })).items;
    expect(records).toHaveLength(24);
    expect(records.every((agent) => agent.updatedAt === 2)).toBe(true);
  } finally {
    for (const child of children) child.kill("SIGKILL");
  }
}, 15000);
