import { JsonlLocalAgentStore } from "@cursor/sdk";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { conversationStores } from "../../src/server/conversation-store.js";
import { acquireLocalLease } from "../../src/server/local-state.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cursor-stores-"));
  roots.push(root);
  const legacy = new JsonlLocalAgentStore(root);
  const stores = conversationStores(root, (path) => new JsonlLocalAgentStore(path));

  const agent = {
    agentId: "one",
    cwd: "/tmp",
    status: "idle" as const,
    createdAt: 1,
    updatedAt: 2,
    sdkMetadata: { opaque: [1, 2] },
    latestCheckpoint: { schemaVersion: 1 as const, rootBlobId: "root" },
  };

  await legacy.agents.create({ agent });
  await legacy.checkpoints.create({ agentId: "one", blobId: "root", data: Buffer.from("memory") });

  return { root, legacy, stores, agent };
}

test("migrates only the selected conversation and publishes after checkpoint/run/event copies", async () => {
  const { root, legacy, stores, agent } = await fixture();
  await legacy.agents.create({ agent: { ...agent, agentId: "other" } });

  const run = {
    agentId: "one",
    runId: "run",
    turnNumber: 1,
    status: "finished" as const,
    createdAt: 1,
    updatedAt: 2,
    latestCheckpointRef: agent.latestCheckpoint,
  };

  await legacy.runs.create({ run });

  for (let i = 0; i < 105; i++)
    await legacy.runEvents.append({
      runId: "run",
      eventType: "message",
      payload: { text: String(i) },
      idempotencyKey: String(i),
    });
  const release = acquireLocalLease(root, "agent:one");

  try {
    const isolated = await stores.open("one");
    expect(await isolated.agents.get({ agentId: "one" })).toEqual(agent);
    expect(await isolated.agents.get({ agentId: "other" })).toBeNull();
    expect(await isolated.runs.get({ agentId: "one", runId: "run" })).toEqual(run);
    const page = await isolated.runEvents.list({ runId: "run", limit: 100 });
    expect(page.items).toHaveLength(100);
    expect(
      (await isolated.runEvents.list({ runId: "run", afterOffset: page.nextOffset })).items,
    ).toHaveLength(5);
    const copy = await stores.open("one");
    await copy.checkpoints.update({ agentId: "one", blobId: "root", data: Buffer.from("updated") });
    expect(await legacy.checkpoints.get({ agentId: "one", blobId: "root" })).toEqual(
      Buffer.from("memory"),
    );
    expect(await copy.checkpoints.get({ agentId: "one", blobId: "root" })).toEqual(
      Buffer.from("updated"),
    );
    expect(await readdir(join(root, "sessions"))).toHaveLength(1);
  } finally {
    release();
  }
});

test("independent stores do not wait on another conversation's I/O lock", async () => {
  const { stores, agent } = await fixture();
  const one = stores.allocate();
  const two = stores.allocate();
  await one.store.agents.create({ agent });
  await one.publish(agent.agentId);
  await two.store.agents.create({ agent: { ...agent, agentId: "two" } });
  await two.publish("two");
  const release = acquireLocalLease(one.path, "store");

  try {
    expect(await two.store.agents.get({ agentId: "two" })).toMatchObject({ agentId: "two" });
    expect((await stores.open("two")).agents).toBeDefined();
  } finally {
    release();
  }
});

test("a failed migration leaves legacy history intact and never publishes a partial store", async () => {
  const { root, legacy, stores, agent } = await fixture();
  await legacy.checkpoints.delete({ filter: { agentIds: ["one"] } });
  await expect(stores.open("one")).rejects.toThrow("root is missing");
  expect(await legacy.agents.get({ agentId: "one" })).toEqual(agent);
  expect(await readdir(join(root, "sessions"))).toHaveLength(0);
  await legacy.checkpoints.create({
    agentId: "one",
    blobId: "root",
    data: Buffer.from("repaired"),
  });
  expect(
    await (await stores.open("one")).checkpoints.get({ agentId: "one", blobId: "root" }),
  ).toEqual(Buffer.from("repaired"));
});

test("damaged published stores or indices never fall back to stale legacy state", async () => {
  const { root, stores } = await fixture();
  const isolated = await stores.open("one");
  await isolated.agents.delete({ filter: { agentIds: ["one"] } });
  await expect(stores.open("one")).rejects.toThrow("isolated Cursor store is missing");
  const location = join(root, "locations", (await readdir(join(root, "locations")))[0]);
  expect(await readFile(location, "utf8")).not.toContain("/tmp");
  await writeFile(location, '{"version":1,"directory":"../../escape"}');
  await expect(stores.open("one")).rejects.toThrow();
});

test("legacy forks hold migration in place until their source snapshot is complete", async () => {
  const { root, stores, agent } = await fixture();
  const release = acquireLocalLease(root, "migration:one");

  try {
    await expect(stores.open("one")).rejects.toThrow("live process");
    expect(await (await stores.open("one", false)).agents.get({ agentId: "one" })).toEqual(agent);
  } finally {
    release();
  }

  expect(await (await stores.open("one")).agents.get({ agentId: "one" })).toEqual(agent);
});
