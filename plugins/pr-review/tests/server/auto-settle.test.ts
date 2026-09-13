import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { Schema } from "effect";
import plugin from "../../server";
import { parsePrUrl } from "../../src/shared/links-contract";

const url = "https://github.com/org/api/pull/42";

const other = "https://github.com/org/web/pull/7";

async function setup() {
  let thread = makeThreadResponse({ id: "t1", status: "idle", environmentId: "env" });
  let childBusy = false;
  const states = new Map<string, "OPEN" | "CLOSED" | "MERGED">();
  let failedUrl = "";
  let archiveFails = false;
  let duringFetch = () => {};

  const initial = createFakePluginHost({
    pluginId: "pr-review",
    sdk: {
      threads: {
        get: async () => thread,
        list: async () =>
          childBusy ? [makeThreadResponse({ id: "child", status: "active" })] : [],
        archive: async () => {
          if (archiveFails) throw new Error("Archive failed");
          thread = { ...thread, archivedAt: 10 };

          return { thread };
        },
      },
      environments: { get: async () => ({ path: "/repo", hostId: "host" }) },
    },
    experimental_callHostRpc: async ({ input }) => {
      const request = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(input);

      if (request.url === failedUrl) throw new Error("GitHub unavailable");
      duringFetch();

      return {
        ...parsePrUrl(request.url),
        title: "Change",
        state: states.get(request.url) ?? "OPEN",
        isDraft: false,
      };
    },
  });

  let harness = initial.harness;
  await plugin(initial.bb);

  return {
    states,
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
