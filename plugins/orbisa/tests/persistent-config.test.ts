import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect } from "effect";
import { remoteUserConfig } from "../persistent-catalog.ts";

void test("remote user configuration is injectable and defaults only when absent", async () => {
  const read = (values: Record<string, string>) =>
    Effect.runPromise(
      remoteUserConfig.pipe(
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown(values, { preserveEmptyStrings: true })),
        ),
      ),
    );

  assert.equal(await read({}), "lucas_netto");
  assert.equal(await read({ ORBISA_REMOTE_USER: "test_user" }), "test_user");
  await assert.rejects(read({ ORBISA_REMOTE_USER: "invalid user" }));
  await assert.rejects(read({ ORBISA_REMOTE_USER: "" }));
});
