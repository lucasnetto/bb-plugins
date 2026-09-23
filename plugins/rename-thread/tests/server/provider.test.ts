import { afterEach, expect, it } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { Effect } from "effect";
import { makePlugin } from "../../src/server/server";
import { parseProviderTitle } from "../../src/server/provider";
import { statusSchema } from "../../src/shared/contract";

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

async function setup(output: string, active = false, fullOnly = false) {
  let title = "Original title";

  const { bb, harness } = createFakePluginHost({
    pluginId: "rename-thread",
    // A non-Codex provider must not need a Codex home.
    dataDir: "/tmp/custom-profile",
    sdk: {
      providers: {
        list: async () => [
          {
            id: "pi",
            displayName: "Pi",
            available: true,
            pluginId: "pi",
            logoUrl: null,
            composerActions: [],
            maintenance: { health: false, installation: false, usage: false },
            capabilities: {
              modelCatalogScope: "host",
              permissionModes: fullOnly ? ["full"] : ["accept-edits", "full"],
              supportsFork: false,
              supportsNativeUserQuestion: false,
              supportsServiceTier: false,
              supportsSessionRewind: false,
              supportsThreadArchive: false,
              supportsThreadRename: false,
            },
          },
        ],
      },
      projects: {
        list: async () => [
          {
            id: "personal",
            kind: "personal",
            name: "Personal",
            sources: [],
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            title,
            status: threadId === "helper" && active ? "active" : "idle",
          }),
        spawn: async () => makeThreadResponse({ id: "helper" }),
        output: async () => ({ output }),
        stop: async () => ({ ok: true }),
        archive: async () => makeThreadResponse({ id: "helper", archivedAt: 1 }),
        update: async (input) => {
          title = input.title ?? title;

          return makeThreadResponse({ id: "target", title });
        },
        events: {
          list: async () => [
            {
              id: "e1",
              seq: 1,
              threadId: "target",
              createdAt: 1,
              scope: { kind: "thread" },
              type: "item/completed",
              data: {
                providerThreadId: "provider-target",
                item: {
                  type: "agentMessage",
                  id: "a1",
                  text: "Add a provider picker",
                },
              },
            },
          ],
        },
      },
    },
  });

  disposers.push(() => harness.lifecycle.dispose());
  makePlugin(() => Effect.die("The Codex generator must not run"))(bb);

  const selected = {
    providerId: "pi",
    model: "anthropic/claude-sonnet-4-6",
    reasoningLevel: "medium",
  };

  await harness.behavior.callRpc("setModelSelection", selected);
  expect(await harness.behavior.callRpc("getModelSelection", {})).toEqual(selected);
  await harness.behavior.callRpc("start", { threadId: "target" });

  return { harness, selected, title: () => title };
}

it.each([false, true])(
  "executes the selected provider with supported permissions (full only: %s)",
  async (fullOnly) => {
    const test = await setup('{"title":"Choose a title provider"}', false, fullOnly);
    await expect
      .poll(
        async () =>
          statusSchema.parse(await test.harness.behavior.callRpc("status", { threadId: "target" }))
            .status,
      )
      .toBe("renamed");
    expect(test.title()).toBe("Choose a title provider");
    expect(test.harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
      ...test.selected,
      visibility: "hidden",
      permissionMode: fullOnly ? "full" : "accept-edits",
      projectId: "personal",
      environment: { type: "host", workspace: { type: "personal" } },
    });
    expect(test.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
    expect(test.harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(1);
  },
);

it("keeps the title and cleans up when the provider returns invalid output", async () => {
  const test = await setup("Here is a long explanation instead of JSON");
  await expect
    .poll(
      async () =>
        statusSchema.parse(await test.harness.behavior.callRpc("status", { threadId: "target" }))
          .status,
    )
    .toBe("failed");
  expect(test.title()).toBe("Original title");
  expect(test.harness.inspection.sdk.callsTo("threads.update")).toHaveLength(0);
  expect(test.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
  expect(test.harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(1);
});

it("stops and archives the helper when the plugin is disposed", async () => {
  const test = await setup("", true);
  await expect.poll(() => test.harness.inspection.sdk.callsTo("threads.spawn").length).toBe(1);
  await test.harness.lifecycle.dispose();
  expect(test.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
  expect(test.harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(1);
  expect(test.harness.inspection.sdk.callsTo("threads.update")).toHaveLength(0);
});

it("accepts JSON fences but rejects extra output and invalid titles", () => {
  expect(parseProviderTitle('```json\n{"title":"Choose a provider"}\n```')).toBe(
    "Choose a provider",
  );
  expect(() => parseProviderTitle('{"title":"New thread"}')).toThrow();
  expect(() => parseProviderTitle('{"title":"Good title","extra":"text"}')).toThrow();
  expect(() => parseProviderTitle(null)).toThrow();
});
