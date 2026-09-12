import assert from "node:assert/strict";
import { test } from "node:test";
import { concurrently } from "../task-concurrency.ts";

void test("pool fills available slots, bounds concurrency and retains input order", async () => {
  let active = 0,
    maximum = 0;
  const releases: (() => void)[] = [];
  const promise = concurrently([0, 1, 2, 3, 4], 3, new AbortController().signal, async (item) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    active--;
    return item;
  });
  assert.equal(active, 3);
  releases[1]!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 4);
  releases[0]!();
  releases[2]!();
  releases[3]!();
  await new Promise((resolve) => setImmediate(resolve));
  releases[4]!();
  assert.deepEqual(await promise, [0, 1, 2, 3, 4]);
  assert.equal(maximum, 3);
});

void test("first failure cancels siblings, skips queued work and drains started operations", async () => {
  const failure = new Error("checkout failed");
  const started: number[] = [];
  let aborted = false,
    drained = false,
    finished = false;
  let release!: () => void;
  const promise = concurrently([0, 1, 2], 2, new AbortController().signal, async (item, signal) => {
    started.push(item);
    if (item === 0) throw failure;
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          release = resolve;
        },
        { once: true },
      ),
    );
    drained = true;
  });
  const checked = assert.rejects(promise, (error) => {
    finished = true;
    return error === failure;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(aborted);
  assert.equal(finished, false);
  release();
  await checked;
  assert.ok(drained);
  assert.deepEqual(started, [0, 1]);
});

void test("parent cancellation stops scheduling and waits for active work", async () => {
  const controller = new AbortController();
  const started: number[] = [];
  let release!: () => void;
  const promise = concurrently([0, 1], 1, controller.signal, async (item) => {
    started.push(item);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const checked = assert.rejects(promise, { name: "AbortError" });
  controller.abort();
  release();
  await checked;
  assert.deepEqual(started, [0]);
});
