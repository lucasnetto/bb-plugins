import { JsonlLocalAgentStore, type SDKAgent } from "@cursor/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import { forkLocalAgent } from "../../src/server/fork.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "cursor-fork-"));
  directories.push(dir);
  const store = new JsonlLocalAgentStore(dir);

  const source = {
    agentId: "source",
    cwd: "/source",
    status: "idle" as const,
    activeRunId: null,
    createdAt: 1,
    updatedAt: 1,
    latestCheckpoint: { schemaVersion: 1 as const, rootBlobId: "root" },
    sdkMetadata: { opaque: { value: "preserved" } },
  };

  await store.agents.create({ agent: source });
  await store.checkpoints.create({ agentId: "source", blobId: "root", data: Buffer.from([42]) });

  return { dir, store, source };
}

const unusedResume = async (): Promise<SDKAgent> => {
  throw new Error("resume must not run");
};

test("copies every checkpoint page, preserves metadata, and leaves the source independent", async () => {
  const { dir, store, source } = await fixture();

  for (let i = 0; i < 105; i++)
    await store.checkpoints.create({
      agentId: "source",
      blobId: `blob-${i}`,
      data: Buffer.from([i]),
    });
  let child = "";
  // Inspect the committed clone at the SDK resume boundary, then fail to exercise rollback.
  await expect(
    Effect.runPromise(
      forkLocalAgent(store, "source", "/child", async (id) => {
        child = id;
        const persisted = new JsonlLocalAgentStore(dir);
        expect(await persisted.agents.get({ agentId: id })).toMatchObject({
          ...source,
          agentId: id,
          cwd: "/child",
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        });

        for (let i = 0; i < 105; i++)
          expect(await persisted.checkpoints.get({ agentId: id, blobId: `blob-${i}` })).toEqual(
            Buffer.from([i]),
          );
        await persisted.checkpoints.update({
          agentId: id,
          blobId: "root",
          data: Buffer.from([99]),
        });
        expect(await persisted.checkpoints.get({ agentId: "source", blobId: "root" })).toEqual(
          Buffer.from([42]),
        );
        throw new Error("resume failed");
      }),
    ),
  ).rejects.toThrow("resume failed");
  expect(await store.agents.get({ agentId: child })).toBeNull();
  expect((await store.checkpoints.list({ filter: { agentIds: [child] } })).items).toEqual([]);
  expect(await store.agents.get({ agentId: "source" })).toEqual(source);
});

test("rejects missing, unfinished, and incomplete source conversations", async () => {
  const { store, source } = await fixture();
  await expect(
    Effect.runPromise(forkLocalAgent(store, "missing", "/child", unusedResume)),
  ).rejects.toThrow("no saved checkpoint");
  await store.agents.update({ agent: { ...source, activeRunId: "run-1" } });
  await expect(
    Effect.runPromise(forkLocalAgent(store, "source", "/child", unusedResume)),
  ).rejects.toThrow("finish");
  await store.agents.update({ agent: source });
  await store.checkpoints.delete({ filter: { agentIds: ["source"] } });
  await expect(
    Effect.runPromise(forkLocalAgent(store, "source", "/child", unusedResume)),
  ).rejects.toThrow("missing");
  expect((await store.agents.list()).items).toEqual([source]);
});

test("rolls back a copy when the source changes during checkpoint reads", async () => {
  const { store, source } = await fixture();
  const get = store.checkpoints.get.bind(store.checkpoints);
  store.checkpoints.get = async (input) => {
    const data = await get(input);

    if (input.agentId === "source")
      await store.agents.update({ agent: { ...source, updatedAt: 2 } });

    return data;
  };

  await expect(
    Effect.runPromise(forkLocalAgent(store, "source", "/child", unusedResume)),
  ).rejects.toThrow("changed while forking");
  expect((await store.agents.list()).items).toHaveLength(1);
  expect((await store.checkpoints.list()).items).toEqual(["root"]);
});

test("historical forks select the saved run checkpoint and leave the latest source intact", async () => {
  const { dir, store, source } = await fixture();
  await store.checkpoints.create({ agentId: "source", blobId: "earlier", data: Buffer.from([7]) });
  await store.runs.create({
    run: {
      agentId: "source",
      runId: "earlier-run",
      turnNumber: 1,
      status: "finished",
      createdAt: 1,
      updatedAt: 1,
      latestCheckpointRef: { schemaVersion: 1, rootBlobId: "earlier" },
    },
  });
  // Reopen the store to verify checkpoint selection survives bridge restarts.
  await expect(
    Effect.runPromise(
      forkLocalAgent(
        new JsonlLocalAgentStore(dir),
        "source",
        "/child",
        async (id) => {
          expect(await store.agents.get({ agentId: id })).toMatchObject({
            latestCheckpoint: { rootBlobId: "earlier" },
          });
          expect(await store.agents.get({ agentId: "source" })).toEqual(source);
          await expect(
            Effect.runPromise(
              forkLocalAgent(
                store,
                id,
                "/grandchild",
                async (grandchild) => {
                  expect(await store.agents.get({ agentId: grandchild })).toMatchObject({
                    latestCheckpoint: { rootBlobId: "earlier" },
                  });
                  throw new Error("inspected repeated edit");
                },
                undefined,
                "earlier",
              ),
            ),
          ).rejects.toThrow("inspected repeated edit");
          throw new Error("inspected historical clone");
        },
        undefined,
        "earlier",
      ),
    ),
  ).rejects.toThrow("inspected historical clone");
});

test("unavailable historical checkpoints never fall back to the latest state", async () => {
  const { store } = await fixture();
  await expect(
    Effect.runPromise(
      forkLocalAgent(store, "source", "/child", unusedResume, undefined, "missing"),
    ),
  ).rejects.toThrow("checkpoint is missing");
  expect((await store.agents.list()).items).toHaveLength(1);
});
