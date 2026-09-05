import { test, expect } from "vite-plus/test";
import { rpcContract } from "../../src/shared/contract";

test("hidden models retain RPC limits, required labels, and unknown-key stripping", async () => {
  const validate = rpcContract.hidden_set.input["~standard"].validate;
  const model = { providerId: "codex", model: "gpt-5", displayName: "GPT-5" };
  expect(await validate({ hidden: [{ ...model, extra: true }] })).toEqual({
    value: { hidden: [model] },
  });
  expect(
    (await validate({ hidden: Array.from({ length: 500 }, () => model) })).issues,
  ).toBeUndefined();
  expect(
    (await validate({ hidden: Array.from({ length: 501 }, () => model) })).issues,
  ).toBeDefined();
  expect((await validate({ hidden: [{ ...model, displayName: "" }] })).issues).toBeDefined();
});
