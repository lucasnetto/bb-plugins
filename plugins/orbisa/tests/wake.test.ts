import { test } from "node:test";
import assert from "node:assert/strict";
import { WakeJobs, validateSlot } from "../wake.ts";

void test("concurrent messages share one wake and can wake again after completion", async () => {
  let count = 0;
  let release = () => {};
  const jobs = new WakeJobs(async () => {
    count++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const first = jobs.start("host_a", "180seg-orbisa-01");
  assert.equal(jobs.start("host_a", "180seg-orbisa-01"), first);
  await Promise.resolve();
  assert.equal(count, 1);
  release();
  await first;
  const next = jobs.start("host_a", "180seg-orbisa-01");
  await Promise.resolve();
  assert.equal(count, 2);
  release();
  await next;
});
void test("failure holds automatic attempts until explicit retry", async () => {
  let count = 0;
  const jobs = new WakeJobs(async () => {
    if (++count === 1) throw new Error("offline");
  });
  await jobs.start("host_a", "180seg-orbisa-01");
  assert.equal(jobs.failed("host_a"), true);
  await jobs.start("host_a", "180seg-orbisa-01");
  assert.equal(count, 1);
  await jobs.start("host_a", "180seg-orbisa-01", true);
  assert.equal(count, 2);
  assert.equal(jobs.failed("host_a"), false);
});
void test("only the three assigned VM slots are accepted", () => {
  assert.equal(validateSlot("180seg-orbisa-03"), "180seg-orbisa-03");
  assert.throws(() => validateSlot("cursor-base"));
  assert.throws(() => validateSlot("-oProxyCommand=bad"));
});
