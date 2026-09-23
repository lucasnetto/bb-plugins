import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { createRecovery } from "../recovery";
import { readHistory } from "../history";
import plugin from "../server";

type Event = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>>[number];

const execution = {
  model: "original-model",
  permissionMode: "auto" as const,
  reasoningLevel: "high" as const,
  serviceTier: "fast" as const,
  source: "client/turn/requested" as const,
};

function user(seq: number, text: string): Event {
  return {
    id: `event-${seq}`,
    seq,
    threadId: "source",
    createdAt: seq,
    scope: { kind: "thread" },
    type: "client/turn/requested",
    data: {
      direction: "outbound",
      execution,
      initiator: "user",
      input: [
        { type: "text", text, mentions: [] },
        { type: "localFile", path: "/old/notes.md" },
      ],
      request: { method: "turn/start", params: {} },
      requestId: `request-${seq}`,
      senderThreadId: null,
      source: "tell",
      target: { kind: "new-turn" },
    },
  };
}

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function fixture(history = [user(1, "Original goal"), user(2, "Latest constraint")]) {
  let source = makeThreadResponse({
    id: "source",
    projectId: "project",
    environmentId: "old",
    archivedAt: 1,
    status: "idle",
  });

  let status = "destroyed";
  let missing = false;
  let failure = false;
  let change = false;

  const host = createFakePluginHost({
    pluginId: "environment-recovery",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          threadId === "source" ? source : makeThreadResponse({ id: "recovered" }),
        defaultExecutionOptions: async () => execution,
        spawn: async () => {
          if (failure) throw new Error("Response lost");

          return makeThreadResponse({ id: "recovered" });
        },
        events: {
          list: async (input) => {
            if (change) source = { ...source, updatedAt: source.updatedAt + 1 };

            const rows = history.filter(
              (event) => !input.beforeSeq || event.seq < Number(input.beforeSeq),
            );

            return (input.order === "desc" ? rows.reverse() : rows).slice(0, Number(input.limit));
          },
        },
      },
      environments: {
        get: async () => ({
          id: "old",
          status,
          hostId: "original-host",
          branchName: "feature",
          isGitRepo: true,
        }),
        listProviders: async () => [{ id: "git-worktree", availability: { status: "available" } }],
      },
      projects: {
        branches: async (input) => ({
          branches: ["main", "feature"],
          remoteBranches: ["origin/feature"],
          selectedBranch: {
            name: input.selectedBranch,
            kind: missing && input.selectedBranch === "feature" ? "missing" : "local",
          },
        }),
      },
    },
  });

  const recovery = createRecovery(host.bb);
  cleanup.push(async () => {
    await recovery.close();
    await host.harness.lifecycle.dispose();
  });

  return {
    ...host,
    recovery,
    setSource: (value: Partial<typeof source>) => {
      source = { ...source, ...value };
    },
    setStatus: (value: string) => {
      status = value;
    },
    missing: () => {
      missing = true;
    },
    fail: () => {
      failure = true;
    },
    change: () => {
      change = true;
    },
  };
}

test("preview and recovery route to the original host, preserve settings, and leave the original intact", async () => {
  const f = fixture();
  expect(await f.recovery.preview({ threadId: "source" })).toMatchObject({
    branch: "feature",
    available: true,
  });
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  await f.recovery.recover({ threadId: "source" });
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toMatchObject([
    [
      {
        projectId: "project",
        model: "original-model",
        permissionMode: "auto",
        reasoningLevel: "high",
        serviceTier: "fast",
        environment: {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: "original-host" },
          inputs: { branch: { kind: "named", name: "feature" } },
        },
        prompt: expect.stringContaining("Original goal"),
        pluginMetadata: { sourceThreadId: "source", branch: "feature" },
      },
    ],
  ]);
  expect(f.harness.inspection.sdk.callsTo("threads.unarchive")).toHaveLength(0);
  expect(f.harness.inspection.sdk.callsTo("threads.fork")).toHaveLength(0);
  expect(f.harness.inspection.sdk.callsTo("environments.delete")).toHaveLength(0);
  expect(f.harness.inspection.sdk.callsTo("projects.branches")[0]).toMatchObject([
    { hostId: "original-host", selectedBranch: "feature" },
  ]);
});

test("a missing branch never falls back silently; explicit replacement is allowed", async () => {
  const f = fixture();
  f.missing();
  expect(await f.recovery.preview({ threadId: "source" })).toMatchObject({ available: false });
  await expect(f.recovery.recover({ threadId: "source" })).rejects.toThrow("branch is missing");
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  expect(await f.recovery.recover({ threadId: "source", branch: "origin/feature" })).toMatchObject({
    branch: "origin/feature",
  });
});

test("concurrent clicks and plugin restarts reuse a single recovery", async () => {
  const f = fixture();
  await Promise.all([
    f.recovery.recover({ threadId: "source" }),
    f.recovery.recover({ threadId: "source" }),
  ]);
  expect(await createRecovery(f.bb).recover({ threadId: "source" })).toMatchObject({
    threadId: "recovered",
    reused: true,
  });
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
});

test("lost creation responses never cause an automatic duplicate", async () => {
  const f = fixture();
  f.fail();
  await expect(f.recovery.recover({ threadId: "source" })).rejects.toThrow("Response lost");
  await expect(createRecovery(f.bb).recover({ threadId: "source" })).rejects.toThrow(
    "may have created",
  );
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
});

test("live environments, running threads, queued work, and source races cannot start recovery", async () => {
  for (const status of ["ready", "retiring", "creating"]) {
    const f = fixture();
    f.setStatus(status);
    await expect(f.recovery.recover({ threadId: "source" })).rejects.toThrow("not been removed");
  }

  for (const update of [
    { status: "active" as const },
    { queuedMessageCount: 1 },
    { activeBackgroundAgentCount: 1 },
  ]) {
    const f = fixture();
    f.setSource(update);
    await expect(f.recovery.recover({ threadId: "source" })).rejects.toThrow("Stop this thread");
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  }

  const f = fixture();
  f.change();
  await expect(f.recovery.recover({ threadId: "source" })).rejects.toThrow("source thread changed");
});

test("history is bounded, marks omissions, and keeps the original and latest requests", async () => {
  const history = [
    user(1, "Original goal"),
    ...Array.from({ length: 140 }, (_, n) => user(n + 2, "Update ".repeat(100))),
    user(200, "Latest constraint"),
  ];

  const f = fixture(history);
  const result = await readHistory(f.bb, "source");
  expect(result.truncated).toBe(true);
  expect(result.originalRequest).toContain("Original goal");
  expect(result.recent.at(-1)).toContain("Latest constraint");
  expect(result.recent.at(-1)).toContain("contents were not copied");
  expect(JSON.stringify(result).length).toBeLessThan(50_000);
});

test("CLI previews are read-only and unknown flags fail", async () => {
  const f = fixture();
  plugin(f.bb);
  expect((await f.harness.behavior.runCli(["preview", "source", "--json"])).exitCode).toBe(0);
  expect(
    (await f.harness.behavior.runCli(["recover", "source", "--brnach", "main"])).exitCode,
  ).toBe(1);
  expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
});

test("plugin uses only public SDK surfaces", () => {
  const result = experimental_scanPublicSdkOnly(new URL("..", import.meta.url).pathname, {
    allow: [/^react$/, /^@testing-library\/react$/, /^vite-plus(?:\/test)?$/],
  });

  expect(result.violations).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});
