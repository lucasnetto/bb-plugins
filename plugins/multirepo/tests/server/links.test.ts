import { Schema } from "effect";

import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/server";
import { parsePrUrl } from "../../src/shared/links-contract";
const url = "https://github.com/org/api/pull/42";
function setup() {
  return createFakePluginHost({
    pluginId: "multirepo",
    sdk: {
      threads: { get: async ({ threadId }) => ({ id: threadId, environmentId: "env-remote" }) },
      environments: { get: async () => ({ path: "/parent", hostId: "remote-host" }) },
    },
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      assert.equal(hostId, "remote-host");
      const request = Schema.decodeUnknownSync(
        Schema.Struct({ root: Schema.String, url: Schema.String }),
      )(input);
      assert.equal(request.root, "/parent");
      const ref = parsePrUrl(request.url);
      if (ref.number === 404) throw new Error("PR not found");
      const pr = { ...ref, title: "Fix validation", state: "OPEN", isDraft: false };
      if (method === "linkedSummary") return pr;
      if (method === "linkedDetail")
        return {
          pr,
          body: "Description",
          headRefName: "fix",
          baseRefName: "main",
          repositoryRoot: null,
          files: [],
        };
      throw new Error(`Unexpected host method ${method}`);
    },
  });
}
test("normalizes PR identity and rejects non-PR/foreign URLs", () => {
  assert.equal(parsePrUrl("https://github.com/ORG/API/pull/42/files?x=1#diff").url, url);
  for (const bad of [
    "https://example.com/org/api/pull/42",
    "https://github.com/org/api/issues/42",
    "https://github.com/org/api/pull/0",
    "https://github.com@evil.com/org/api/pull/42",
    "https://github.com/org/api/pull/9007199254740993",
  ])
    assert.throws(() => parsePrUrl(bad));
});
test("agent tools append concurrently, deduplicate, persist on reload, and unlink only the current thread", async () => {
  const initial = setup();
  const bb = initial.bb;
  let harness = initial.harness;
  try {
    plugin(bb);
    await Promise.all([
      harness.behavior.callAgentTool(
        "link_pull_request",
        { url, reason: "created-here" },
        { threadId: "t1" },
      ),
      harness.behavior.callAgentTool(
        "link_pull_request",
        { url: "https://github.com/org/web/pull/7", reason: "requested-review" },
        { threadId: "t1" },
      ),
    ]);
    await harness.behavior.callAgentTool(
      "link_pull_request",
      { url: "https://github.com/ORG/API/pull/42/files", reason: "manual" },
      { threadId: "t1" },
    );
    await harness.behavior.callAgentTool(
      "link_pull_request",
      { url, reason: "manual" },
      { threadId: "t2" },
    );
    const before = await harness.behavior.callRpc("linkedList", { threadId: "t1" });
    assert.equal((before as unknown[]).length, 2);
    assert.match(JSON.stringify(before), /created-here/);
    ({ harness } = await harness.lifecycle.reload(plugin));
    assert.deepEqual(await harness.behavior.callRpc("linkedList", { threadId: "t1" }), before);
    await harness.behavior.callAgentTool("unlink_pull_request", { url }, { threadId: "t1" });
    assert.equal(
      ((await harness.behavior.callRpc("linkedList", { threadId: "t1" })) as unknown[]).length,
      1,
    );
    assert.equal(
      ((await harness.behavior.callRpc("linkedList", { threadId: "t2" })) as unknown[]).length,
      1,
    );
    const missing = await harness.behavior.callRpc("linkedUnlink", { threadId: "t1", url });
    assert.deepEqual(missing, { removed: false });
  } finally {
    await harness.lifecycle.dispose();
  }
});
test("failed validation does not save a link; URL review uses thread host without project settings or checkout", async () => {
  const initial = setup();
  const bb = initial.bb;
  let harness = initial.harness;
  try {
    plugin(bb);
    await assert.rejects(() =>
      harness.behavior.callRpc("linkedLink", {
        threadId: "t1",
        url: "https://github.com/org/api/pull/404",
        reason: "manual",
      }),
    );
    assert.deepEqual(await harness.behavior.callRpc("linkedList", { threadId: "t1" }), []);
    await harness.behavior.callAgentTool(
      "link_pull_request",
      { url, reason: "requested-work" },
      { threadId: "t1" },
    );
    const detail = await harness.behavior.callRpc("linkedDetail", { threadId: "t1", url });
    assert.match(JSON.stringify(detail), /"repositoryRoot":null/);
    assert.equal(harness.inspection.sdk.callsTo("threads.spawn").length, 0);
    await assert.rejects(() =>
      harness.behavior.callRpc("linkedDetail", { threadId: "other", url }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("code comment chips resolve their exact snapshot after reload and reject unlinked threads", async () => {
  const initial = setup();
  let harness = initial.harness;
  try {
    plugin(initial.bb);
    const input = {
      threadId: "t1",
      url,
      label: "file.ts · 11–12",
      context: "PR selection\n+new\n+extra\nPlease simplify.",
    };
    await assert.rejects(() => harness.behavior.callRpc("stageReviewComment", input));
    await harness.behavior.callRpc("linkedLink", { threadId: "t1", url, reason: "manual" });
    const { id } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
      await harness.behavior.callRpc("stageReviewComment", input),
    );
    ({ harness } = await harness.lifecycle.reload(plugin));
    const provider = harness.inspection.registrations.mentionProviders.find(
      (p) => p.id === "review-comment",
    )!;
    assert.deepEqual(await provider.resolve(id), { context: input.context });
    await assert.rejects(async () => provider.resolve("missing"), /no longer available/);
  } finally {
    await harness.lifecycle.dispose();
  }
});
