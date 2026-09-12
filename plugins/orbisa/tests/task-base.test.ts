import assert from "node:assert/strict";
import { test } from "node:test";
import { baseFingerprint, serializeBase } from "../task-base.ts";

void test("base refresh tracks BB artifact content, Codex, source and skills", () => {
  const versions = ["source-a", "artifact-a", "codex-a", "skills-a"] as const;
  const original = baseFingerprint(...versions);
  assert.equal(baseFingerprint(...versions), original);
  for (let i = 0; i < versions.length; i++) {
    const changed = [...versions] as [string, string, string, string];
    changed[i] += "-updated";
    assert.notEqual(baseFingerprint(...changed), original);
  }
});

void test("concurrent base operations wait and a failed build does not block the next", async () => {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = serializeBase(async () => {
    events.push("first");
    await gate;
    throw new Error("cancelled");
  });
  const failed = assert.rejects(first, /cancelled/);
  const second = serializeBase(async () => {
    events.push("second");
    return "ready";
  });
  await Promise.resolve();
  assert.deepEqual(events, ["first"]);
  release();
  await failed;
  assert.equal(await second, "ready");
  assert.deepEqual(events, ["first", "second"]);
});
