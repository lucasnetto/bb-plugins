import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { Deferred, Effect, Schema } from "effect";
import plugin from "../../server";
import { parsePrUrl } from "../../src/shared/links-contract";
import { overview, stack } from "../workspace-fixture";

const url = "https://github.com/org/api/pull/42";

const other = "https://github.com/org/web/pull/7";

async function setup() {
  let thread = makeThreadResponse({
    id: "t1",
    status: "idle",
    environmentId: "env",
    createdAt: 1000,
  });

  let latestPromptAt = 1000;
  let completedAt: string | null = "2026-09-15T12:00:00Z";
  let childBusy = false;
  const states = new Map<string, "OPEN" | "CLOSED" | "MERGED">();
  let failedUrl = "";
  let archiveFails = false;
  let duringFetch = () => {};

  let archiveCount = 0;
  let summaryCount = 0;

  const initial = createFakePluginHost({
    pluginId: "pr-review",
    sdk: {
      threads: {
        get: async () => thread,
        promptHistory: async () => [{ id: "prompt", createdAt: latestPromptAt, input: [] }],
        list: async () =>
          childBusy ? [makeThreadResponse({ id: "child", status: "active" })] : [],
        archive: async () => {
          if (archiveFails) throw new Error("Archive failed");
          archiveCount++;
          thread = { ...thread, archivedAt: 10 };

          return { thread };
        },
      },
      environments: { get: async () => ({ path: "/repo", hostId: "host" }) },
    },
    experimental_callHostRpc: async ({ method, input }) => {
      const request = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(input);

      if (request.url === failedUrl) throw new Error("GitHub unavailable");
      duringFetch();

      const pr = {
        ...parsePrUrl(request.url),
        title: "Change",
        state: states.get(request.url) ?? "OPEN",
        isDraft: false,
        mergedAt: states.get(request.url) === "MERGED" ? completedAt : null,
        closedAt: states.get(request.url) === "CLOSED" ? completedAt : null,
      };

      if (method === "prOverview") return { ...overview, ...pr };

      if (method === "prStack") return { ...stack, layers: [{ ...stack.layers[1], ...pr }] };

      if (method === "linkedDetail")
        return {
          pr,
          body: "",
          headRefName: "fix",
          baseRefName: "main",
          repositoryRoot: null,
          files: [],
        };
      summaryCount++;

      return pr;
    },
  });

  let harness = initial.harness;
  await plugin(initial.bb);

  return {
    states,
    latestPrompt: (value: number) => {
      latestPromptAt = value;
    },
    completion: (value: string | null) => {
      completedAt = value;
    },
    enable: (autoSettle: boolean) => harness.behavior.setSettings({ autoSettle }),
    childBusy: (value: boolean) => {
      childBusy = value;
    },
    setThread: (overrides: Partial<typeof thread>) => {
      thread = { ...thread, ...overrides };
    },
    fail: (value: string) => {
      failedUrl = value;
    },
    archiveFails: (value: boolean) => {
      archiveFails = value;
    },
    duringFetch: (fn: () => void) => {
      duringFetch = fn;
    },
    link: (value = url) =>
      harness.behavior.callRpc("linkedLink", { threadId: "t1", url: value, reason: "manual" }),
    unlink: (value = url) =>
      harness.behavior.callRpc("linkedUnlink", { threadId: "t1", url: value }),
    sweep: () => harness.behavior.runSchedule("settle-completed-prs"),
    observe: (method: "prOverview" | "prStack" | "linkedDetail", value = url) =>
      harness.behavior.callRpc(method, { threadId: "t1", url: value }),
    archiveCount: () => archiveCount,
    summaryCount: () => summaryCount,
    archived: () => thread.archivedAt !== null,
    reload: async () => {
      ({ harness } = await harness.lifecycle.reload(plugin));
    },
    dispose: () => harness.lifecycle.dispose(),
  };
}

test("all PRs must be closed or merged; empty, open and failed lookups never settle", async () => {
  const h = await setup();

  try {
    await h.sweep();
    assert.equal(h.archived(), false);
    await h.link();
    await h.link(other);
    h.states.set(url, "MERGED");
    await h.sweep();
    assert.equal(h.archived(), false);
    h.states.set(other, "CLOSED");
    h.fail(other);
    await h.sweep();
    assert.equal(h.archived(), false);
    h.fail("");
    await h.sweep();
    assert.equal(h.archived(), true);
  } finally {
    await h.dispose();
  }
});

test.each(["prOverview", "prStack", "linkedDetail"] as const)(
  "%s settles as soon as the last linked PR is observed closed or merged",
  async (method) => {
    const h = await setup();

    try {
      await h.link();
      await h.link(other);
      h.states.set(url, "MERGED");
      const summaries = h.summaryCount();
      await h.observe(method);
      assert.equal(h.archived(), false);
      assert.equal(h.summaryCount(), summaries);
      h.states.set(other, "CLOSED");
      await h.observe(method, other);
      assert.equal(h.archived(), true);
      assert.equal(h.summaryCount(), summaries + (method === "prStack" ? 2 : 1));
      await h.sweep();
      assert.equal(h.archiveCount(), 1);
    } finally {
      await h.dispose();
    }
  },
);

test("observed completion verifies stale siblings and retries failed checks on the fallback sweep", async () => {
  const h = await setup();

  try {
    await h.link();
    await h.link(other);
    h.states.set(url, "CLOSED");
    await h.observe("prOverview");
    h.states.set(url, "OPEN");
    h.states.set(other, "CLOSED");
    await h.observe("linkedDetail", other);
    assert.equal(h.archived(), false);
    h.states.set(url, "MERGED");
    h.fail(other);
    await h.observe("prOverview");
    assert.equal(h.archived(), false);
    h.fail("");
    await h.sweep();
    assert.equal(h.archived(), true);
  } finally {
    await h.dispose();
  }
});

test("observed completion respects settings, busy workers, and manual Un-settle", async () => {
  const h = await setup();

  try {
    await h.link();
    h.states.set(url, "MERGED");
    await h.enable(false);
    await h.observe("prOverview");
    assert.equal(h.archived(), false);
    await h.enable(true);
    h.childBusy(true);
    await h.observe("prOverview");
    assert.equal(h.archived(), false);
    h.childBusy(false);
    await h.observe("prOverview");
    assert.equal(h.archived(), true);
    h.setThread({ archivedAt: null });
    await h.reload();
    await h.observe("prOverview");
    assert.equal(h.archived(), false);
  } finally {
    await h.dispose();
  }
});

test("simultaneous status observations and polling archive only once", async () => {
  const h = await setup();

  try {
    await h.link();
    h.states.set(url, "MERGED");
    await Promise.all([h.observe("prOverview"), h.observe("linkedDetail"), h.sweep()]);
    assert.equal(h.archived(), true);
    assert.equal(h.archiveCount(), 1);
  } finally {
    await h.dispose();
  }
});

test("an old merge cannot settle a newer user request, including after reload", async () => {
  const h = await setup();

  try {
    await h.link();
    h.states.set(url, "MERGED");
    h.latestPrompt(Date.parse("2026-09-15T13:00:00Z"));
    await h.observe("prOverview");
    assert.equal(h.archived(), false);
    await h.reload();
    await h.sweep();
    assert.equal(h.archived(), false);
    await h.link(other);
    h.states.set(other, "CLOSED");
    h.completion("2026-09-15T14:00:00Z");
    await h.observe("linkedDetail", other);
    assert.equal(h.archived(), true);
  } finally {
    await h.dispose();
  }
});

test.each([null, "invalid-date"])(
  "missing or invalid completion time %s defers settlement",
  async (time) => {
    const h = await setup();

    try {
      await h.link();
      h.states.set(url, "MERGED");
      h.completion(time);
      await h.sweep();
      assert.equal(h.archived(), false);
      h.completion("2026-09-15T12:00:00Z");
      await h.sweep();
      assert.equal(h.archived(), true);
    } finally {
      await h.dispose();
    }
  },
);

test("a confirmed merge is reused even if its host lookup later fails", async () => {
  const h = await setup();

  try {
    await h.link();
    h.childBusy(true);
    h.states.set(url, "MERGED");
    await h.observe("prOverview");
    h.fail(url);
    h.childBusy(false);
    await h.reload();
    await h.sweep();
    assert.equal(h.archived(), true);
    assert.equal(h.summaryCount(), 1); // Only the initial link fetched a summary.
  } finally {
    await h.dispose();
  }
});

test("a slow thread does not block another thread from settling", async () => {
  const threads = new Map(
    ["slow", "fast"].map((id) => [
      id,
      makeThreadResponse({ id, status: "idle", environmentId: "env", createdAt: 1000 }),
    ]),
  );

  const blocked = Effect.runSync(Deferred.make<void>());
  const release = Effect.runSync(Deferred.make<void>());
  const fastArchived = Effect.runSync(Deferred.make<void>());
  let checking = false;

  const { bb, harness } = createFakePluginHost({
    pluginId: "pr-review",
    sdk: {
      threads: {
        get: async ({ threadId }) => threads.get(threadId),
        promptHistory: async () => [],
        list: async () => [],
        archive: async ({ threadId }) => {
          const thread = threads.get(threadId);

          if (!thread) throw new Error("Missing thread");
          thread.archivedAt = 10;

          if (threadId === "fast") Effect.runSync(Deferred.succeed(fastArchived, undefined));

          return { thread };
        },
      },
      environments: { get: async () => ({ path: "/repo", hostId: "host" }) },
    },
    experimental_callHostRpc: async ({ input }) => {
      const { url: requested } = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(
        input,
      );

      if (checking && requested === url) {
        Effect.runSync(Deferred.succeed(blocked, undefined));
        await Effect.runPromise(Deferred.await(release));
      }

      return {
        ...parsePrUrl(requested),
        title: "Change",
        state: checking ? "MERGED" : "OPEN",
        isDraft: false,
        mergedAt: checking ? "2026-09-15T12:00:00Z" : null,
      };
    },
  });

  await plugin(bb);
  let sweep: Promise<void> | undefined;

  try {
    await harness.behavior.callRpc("linkedLink", { threadId: "slow", url, reason: "manual" });
    await harness.behavior.callRpc("linkedLink", {
      threadId: "fast",
      url: other,
      reason: "manual",
    });
    checking = true;
    sweep = harness.behavior.runSchedule("settle-completed-prs");
    await Effect.runPromise(Deferred.await(blocked));
    await Effect.runPromise(Deferred.await(fastArchived));
    assert.equal(threads.get("slow")?.archivedAt, null);
    Effect.runSync(Deferred.succeed(release, undefined));
    await sweep;
    assert.equal(threads.get("slow")?.archivedAt, 10);
  } finally {
    Effect.runSync(Deferred.succeed(release, undefined));
    await sweep;
    await harness.lifecycle.dispose();
  }
});

test("busy, queued and hidden threads wait; an idle thread settles on the next pass", async () => {
  const h = await setup();

  try {
    await h.link();
    h.states.set(url, "CLOSED");

    for (const status of ["active", "starting", "pending", "stopping", "error"] as const) {
      h.setThread({ status });
      await h.sweep();
      assert.equal(h.archived(), false);
    }

    h.setThread({ status: "idle", queuedMessageCount: 1 });
    await h.sweep();
    assert.equal(h.archived(), false);
    h.setThread({ queuedMessageCount: 0, visibility: "hidden" });
    await h.sweep();
    assert.equal(h.archived(), false);
    h.setThread({ visibility: "visible", activeBackgroundAgentCount: 1 });
    await h.sweep();
    assert.equal(h.archived(), false);
    h.setThread({ activeBackgroundAgentCount: 0 });
    h.childBusy(true);
    await h.sweep();
    assert.equal(h.archived(), false);
    h.childBusy(false);
    await h.sweep();
    assert.equal(h.archived(), true);
  } finally {
    await h.dispose();
  }
});

test("rechecks thread activity after GitHub calls", async () => {
  const h = await setup();

  try {
    await h.link();
    h.states.set(url, "MERGED");
    h.duringFetch(() => h.setThread({ status: "active" }));
    await h.sweep();
    assert.equal(h.archived(), false);
  } finally {
    await h.dispose();
  }
});

test("Un-settle survives reload and reopening or reclosing the same PR", async () => {
  const h = await setup();

  try {
    await h.link();
    h.states.set(url, "CLOSED");
    await h.sweep();
    assert.equal(h.archived(), true);
    h.setThread({ archivedAt: null });
    await h.reload();
    await h.sweep();
    assert.equal(h.archived(), false);
    h.states.set(url, "OPEN");
    await h.sweep();
    h.states.set(url, "MERGED");
    await h.sweep();
    assert.equal(h.archived(), false);
  } finally {
    await h.dispose();
  }
});

test("a new PR allows settlement after Un-settle, and an archive failure is retried", async () => {
  const h = await setup();

  try {
    await h.link();
    h.states.set(url, "MERGED");
    h.archiveFails(true);
    await h.sweep();
    assert.equal(h.archived(), false);
    h.archiveFails(false);
    await h.sweep();
    assert.equal(h.archived(), true);
    h.setThread({ archivedAt: null });
    await h.link(other);
    await h.sweep();
    assert.equal(h.archived(), false);
    h.states.set(other, "CLOSED");
    await h.sweep();
    assert.equal(h.archived(), true);
  } finally {
    await h.dispose();
  }
});

test("removing or relinking previously settled PRs never counts as a new PR", async () => {
  const h = await setup();

  try {
    await h.link();
    await h.link(other);
    h.states.set(url, "MERGED");
    h.states.set(other, "CLOSED");
    await h.sweep();
    assert.equal(h.archived(), true);
    h.setThread({ archivedAt: null });
    await h.unlink(other);
    await h.sweep();
    assert.equal(h.archived(), false);
    await h.link(other);
    await h.reload();
    await h.sweep();
    assert.equal(h.archived(), false);
  } finally {
    await h.dispose();
  }
});

test("automatic settling can be disabled without losing its previous settlement history", async () => {
  const h = await setup();

  try {
    await h.link();
    h.states.set(url, "MERGED");
    await h.enable(false);
    await h.sweep();
    assert.equal(h.archived(), false);
    await h.enable(true);
    await h.sweep();
    assert.equal(h.archived(), true);
  } finally {
    await h.dispose();
  }
});
