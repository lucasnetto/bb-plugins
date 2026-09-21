import type { SDKModel } from "@cursor/sdk";
import { Deferred, Effect } from "effect";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { createModelCache } from "../../src/server/model-cache.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const original: SDKModel[] = [{ id: "original", displayName: "Original" }];

const updated: SDKModel[] = [{ id: "updated", displayName: "Updated" }];

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "cursor-model-cache-"));
  cleanups.push(() => rm(path, { recursive: true, force: true }));

  return path;
}

function cache(list: () => Promise<SDKModel[]>) {
  const result = createModelCache(() => Effect.succeed({ Cursor: { models: { list } } }));
  cleanups.push(() => result.close());

  return result;
}

async function seed(path: string) {
  const first = cache(async () => original);
  const result = await Effect.runPromise(first.get(path, "work", "secret"));
  first.close();

  return result;
}

async function files(path: string) {
  return (await readdir(join(path, "model-catalogs"))).map((name) =>
    join(path, "model-catalogs", name),
  );
}

test("returns saved models after restart while sharing a blocked background refresh", async () => {
  const path = await directory();
  const saved = await seed(path);
  const pending = Effect.runSync(Deferred.make<SDKModel[]>());
  let calls = 0;

  const next = cache(() => {
    calls++;

    return Effect.runPromise(Deferred.await(pending));
  });

  expect(await Effect.runPromise(next.get(path, "work", "secret"))).toEqual(saved);
  expect(await Effect.runPromise(next.get(path, "work", "secret"))).toEqual(saved);
  expect(calls).toBe(1);

  // Removing the saved copy makes the next caller await the shared refresh.
  for (const file of await files(path)) await rm(file);
  const refreshed = Effect.runPromise(next.get(path, "work", "secret"));
  Effect.runSync(Deferred.succeed(pending, updated));
  expect((await refreshed).models[0].displayName).toBe("Updated");
  expect(calls).toBe(1);
  const restarted = cache(() => new Promise(() => {}));
  expect(
    (await Effect.runPromise(restarted.get(path, "work", "secret"))).models[0].displayName,
  ).toBe("Updated");
});

test("isolates profiles and rotated credentials without writing secrets", async () => {
  const path = await directory();
  await seed(path);
  let calls = 0;

  const next = cache(async () => {
    calls++;

    return updated;
  });

  await Effect.runPromise(next.get(path, "personal", "secret"));
  await Effect.runPromise(next.get(path, "work", "rotated-secret"));
  expect(calls).toBe(2);
  const paths = await files(path);
  expect(paths).toHaveLength(3);

  for (const file of paths) {
    expect(file).not.toContain("secret");
    expect(await readFile(file, "utf8")).not.toContain("secret");
  }
});

test.each(["invalid json", '{"models":[{}],"selectedOnlyModels":[]}'])(
  "refetches corrupt saved data: %s",
  async (contents) => {
    const path = await directory();
    await seed(path);
    await writeFile((await files(path))[0], contents);
    const next = cache(async () => updated);
    expect((await Effect.runPromise(next.get(path, "work", "secret"))).models[0].displayName).toBe(
      "Updated",
    );
  },
);

test("keeps the saved catalog on refresh failure and reports cold failures", async () => {
  const path = await directory();
  const saved = await seed(path);

  const next = cache(async () => {
    throw new Error("Offline");
  });

  expect(await Effect.runPromise(next.get(path, "work", "secret"))).toEqual(saved);
  expect(await Effect.runPromise(next.get(path, "work", "secret"))).toEqual(saved);
  expect(JSON.parse(await readFile((await files(path))[0], "utf8"))).toMatchObject(saved);
  await expect(Effect.runPromise(next.get(path, "personal", "secret"))).rejects.toThrow("Offline");
});

test("returns live models even when the cache cannot be written", async () => {
  const path = await directory();
  await writeFile(join(path, "model-catalogs"), "blocks directory creation");
  const next = cache(async () => original);
  expect((await Effect.runPromise(next.get(path, "work", "secret"))).models[0].displayName).toBe(
    "Original",
  );
});

test("bridge cleanup interrupts its background refresh", async () => {
  const path = await directory();
  await seed(path);
  const started = Effect.runSync(Deferred.make<void>());
  const stopped = Effect.runSync(Deferred.make<void>());

  const next = createModelCache(() =>
    Effect.gen(function* () {
      yield* Deferred.succeed(started, undefined);

      return yield* Effect.never;
    }).pipe(Effect.ensuring(Deferred.succeed(stopped, undefined))),
  );

  cleanups.push(() => next.close());
  await Effect.runPromise(next.get(path, "work", "secret"));
  await Effect.runPromise(Deferred.await(started));
  next.close();
  await Effect.runPromise(Deferred.await(stopped));
});

test("does not replace a saved catalog with an empty response", async () => {
  const path = await directory();
  const saved = await seed(path);
  const next = cache(async () => []);
  expect(await Effect.runPromise(next.get(path, "work", "secret"))).toEqual(saved);
  await expect(Effect.runPromise(next.get(path, "personal", "secret"))).rejects.toThrow();
  expect(JSON.parse(await readFile((await files(path))[0], "utf8"))).toMatchObject(saved);
});

test("native startup uses persisted model parameters while discovery is offline", async () => {
  const path = await directory();

  const models: SDKModel[] = [
    {
      id: "param",
      displayName: "Parameter model",
      parameters: [{ id: "fast", values: [{ value: "true" }, { value: "false" }] }],
      variants: [{ displayName: "Fast", params: [{ id: "fast", value: "true" }] }],
    },
  ];

  await Effect.runPromise(cache(async () => models).native(path, "work", "secret"));

  const offline = cache(async () => {
    throw new Error("Offline");
  });

  expect(await Effect.runPromise(offline.native(path, "work", "secret"))).toEqual(models);
  await expect(Effect.runPromise(offline.native(path, "work", "new-key"))).rejects.toThrow(
    "Offline",
  );
});

test("force refresh resolves a newly selected model and rejects over-age saved catalogs", async () => {
  const path = await directory();
  await seed(path);
  const next = cache(async () => updated);
  expect(await Effect.runPromise(next.native(path, "work", "secret", true))).toEqual(updated);
  const file = (await files(path))[0];
  const saved = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...saved, savedAt: 0 }));
  await expect(
    Effect.runPromise(
      cache(async () => {
        throw new Error("Offline");
      }).native(path, "work", "secret"),
    ),
  ).rejects.toThrow("Offline");
});

test("cold model discovery has a deadline and a late response cannot write its cache", async () => {
  const path = await directory();
  const pending = Deferred.makeUnsafe<SDKModel[]>();

  const next = createModelCache(
    () =>
      Effect.succeed({
        Cursor: { models: { list: () => Effect.runPromise(Deferred.await(pending)) } },
      }),
    10,
  );

  cleanups.push(() => next.close());
  await expect(Effect.runPromise(next.native(path, "work", "secret"))).rejects.toThrow(
    "model discovery timed out",
  );
  Effect.runSync(Deferred.succeed(pending, updated));
  next.close();
  expect(await readdir(path)).toEqual([]);
});
