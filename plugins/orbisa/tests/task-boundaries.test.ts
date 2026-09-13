import assert from "node:assert/strict";
import { test } from "node:test";
import { machineSchema, machineIsolationSchema } from "../task-boundaries.ts";
import { retryConnection } from "../task-startup.ts";

void test("OrbStack inventory validates identity and isolation fields before use", () => {
  const vm = {
    id: "vm-1",
    name: "template",
    state: "stopped",
    config: { isolated: true, isolate_network: true, forward_ssh_agent: false, mounts: [] },
  };

  assert.deepEqual(machineSchema.array().parse([vm]), [vm]);
  assert.equal(machineIsolationSchema.safeParse({ ...vm, state: undefined }).success, true);

  for (const invalid of [
    null,
    { ...vm, id: 1 },
    { ...vm, config: null },
    { ...vm, config: { isolated: "true" } },
    { ...vm, config: { mounts: {} } },
  ]) {
    assert.equal(machineSchema.safeParse(invalid).success, false);
  }
});

void test("retry parsing preserves opaque failures and recognizes direct codes with unrelated causes", async () => {
  const signal = new AbortController().signal;

  for (const failure of [null, "offline", { code: 123 }, { cause: "offline" }]) {
    let attempts = 0;
    await assert.rejects(
      retryConnection(
        async () => {
          attempts++;
          throw failure;
        },
        signal,
        () => {},
        async () => {},
      ),
      (error) => error === failure,
    );
    assert.equal(attempts, 1);
  }

  let attempts = 0;

  const result = await retryConnection(
    async () => {
      if (++attempts === 1)
        throw Object.assign(new Error(), { code: "ECONNRESET", cause: "socket closed" });

      return "connected";
    },
    signal,
    () => {},
    async () => {},
  );

  assert.equal(result, "connected");
  assert.equal(attempts, 2);
});
