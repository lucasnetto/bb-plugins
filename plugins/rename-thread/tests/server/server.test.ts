import { afterEach, describe, expect, it } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { Deferred, Effect } from "effect";
import { makePlugin } from "../../src/server/server";
import { statusSchema } from "../../src/shared/contract";

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

async function setup() {
  let title = "Original title";
  let generationCount = 0;
  const entered = Deferred.makeUnsafe<void>();
  const result = Deferred.makeUnsafe<string>();

  const { bb, harness } = createFakePluginHost({
    pluginId: "rename-thread",
    dataDir: "/tmp/.bb-work",
    sdk: {
      threads: {
        get: async () => makeThreadResponse({ id: "t1", title }),
        update: async (input) => {
          title = input.title ?? title;

          return makeThreadResponse({ id: "t1", title });
        },
        events: {
          list: async () => [
            {
              id: "e1",
              seq: 1,
              threadId: "t1",
              createdAt: 1,
              scope: { kind: "thread" },
              type: "item/completed",
              data: {
                providerThreadId: "provider-t1",
                item: { type: "agentMessage", id: "a1", text: "Build automatic thread renaming" },
              },
            },
          ],
        },
      },
    },
  });

  disposers.push(() => harness.lifecycle.dispose());
  makePlugin(() =>
    Effect.gen(function* () {
      generationCount++;
      yield* Deferred.succeed(entered, undefined);

      return yield* Deferred.await(result);
    }),
  )(bb);

  return {
    harness,
    entered,
    result,
    setTitle: (next: string) => {
      title = next;
    },
    getTitle: () => title,
    count: () => generationCount,
  };
}

async function finished(harness: Awaited<ReturnType<typeof setup>>["harness"]) {
  await expect
    .poll(
      async () =>
        statusSchema.parse(await harness.behavior.callRpc("status", { threadId: "t1" })).status,
    )
    .not.toBe("running");

  return statusSchema.parse(await harness.behavior.callRpc("status", { threadId: "t1" }));
}

describe("regeneration", () => {
  it("deduplicates an in-flight request and applies the result", async () => {
    const test = await setup();
    await test.harness.behavior.callRpc("start", { threadId: "t1" });
    await Effect.runPromise(Deferred.await(test.entered));
    await test.harness.behavior.callRpc("start", { threadId: "t1" });
    await Effect.runPromise(Deferred.succeed(test.result, "Automatic thread renaming"));
    expect((await finished(test.harness)).status).toBe("renamed");
    expect(test.getTitle()).toBe("Automatic thread renaming");
    expect(test.count()).toBe(1);
  });
  it("preserves a title changed while inference is running", async () => {
    const test = await setup();
    await test.harness.behavior.callRpc("start", { threadId: "t1" });
    await Effect.runPromise(Deferred.await(test.entered));
    test.setTitle("My hand-written title");
    await Effect.runPromise(Deferred.succeed(test.result, "Automatic thread renaming"));
    expect((await finished(test.harness)).status).toBe("unchanged");
    expect(test.harness.inspection.sdk.callsTo("threads.update")).toHaveLength(0);
  });
});
