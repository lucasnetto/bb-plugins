import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { test, expect } from "vite-plus/test";
import { Schema } from "effect";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";
import { savedGuideSchema } from "../../src/shared/guide-contract";

const url = "https://github.com/org/api/pull/42";

const target = { threadId: "t1", url };

const base = "a".repeat(40);

const head = "b".repeat(40);

const guide = {
  title: "Validate inputs",
  intent: "Reject invalid requests.",
  sections: [
    {
      title: "Validation",
      overview: "Checks run before saving.",
      diffs: [{ file: "api.ts", summary: "Rejects empty input." }],
    },
  ],
  unplacedFiles: ["api.test.ts"],
};

async function setup(prepareStorage?: (bb: BbPluginApi) => void) {
  let currentHead = head;
  let workerStatus: "active" | "idle" = "active";
  let output = "";
  let hasThreadDefaults = true;
  let hasCatalogModel = true;
  const catalogRequests: unknown[] = [];
  const spawned: unknown[] = [];
  const stopped: string[] = [];
  const archived: string[] = [];
  let spawnGate: (() => Promise<void>) | null = null;

  const host = createFakePluginHost({
    pluginId: "pr-review",
    sdk: {
      threads: {
        get: async ({ threadId }) => ({
          id: threadId,
          environmentId: "env",
          projectId: "project",
          providerId: "codex",
          status: workerStatus,
        }),
        defaultExecutionOptions: async () =>
          hasThreadDefaults
            ? {
                model: "thread-model",
                reasoningLevel: "high",
                serviceTier: "default",
              }
            : null,
        spawn: async (args) => {
          spawned.push(args);
          const id = spawned.length === 1 ? "worker" : `worker-${spawned.length}`;
          const gate = spawnGate;
          spawnGate = null;

          if (gate) await gate();

          return { id };
        },
        output: async () => ({ output }),
        stop: async ({ threadId }) => {
          stopped.push(threadId);

          return { ok: true };
        },
        archive: async ({ threadId }) => {
          archived.push(threadId);

          return { archived: 1 };
        },
      },
      providers: {
        models: async (args) => {
          catalogRequests.push(args);

          return {
            models: hasCatalogModel
              ? [
                  {
                    model: "catalog-model",
                    routeProviderId: "codex",
                    isDefault: true,
                    defaultReasoningEffort: "low",
                  },
                ]
              : [],
            providers: [],
          };
        },
      },
      environments: { get: async () => ({ path: "/workspace", hostId: "remote" }) },
    },
    experimental_callHostRpc: async ({ method }) => {
      const pr = {
        url,
        repository: "org/api",
        number: 42,
        title: "Validate",
        state: "OPEN",
        isDraft: false,
      };

      if (method === "linkedSummary") return pr;

      return {
        pr,
        body: "Reject empty input",
        baseRefName: "main",
        headRefName: "fix",
        baseRefOid: base,
        headRefOid: currentHead,
        repositoryRoot: null,
        files: [
          { path: "api.ts", patch: "@@ -1 +1 @@\n-old\n+new" },
          { path: "api.test.ts", patch: null },
        ],
      };
    },
  });

  prepareStorage?.(host.bb);
  await plugin(host.bb);

  return {
    ...host,
    catalogRequests,
    clearThreadDefaults: () => {
      hasThreadDefaults = false;
    },
    clearCatalog: () => {
      hasCatalogModel = false;
    },
    pauseSpawn: () => {
      let resume!: () => void;
      let notify!: () => void;

      const pending = new Promise<void>((resolve) => {
        resume = resolve;
      });

      const started = new Promise<void>((resolve) => {
        notify = resolve;
      });

      spawnGate = () => {
        notify();

        return pending;
      };

      return { started, resume };
    },
    spawned,
    stopped,
    archived,
    complete: (text = JSON.stringify(guide)) => {
      output = text;
      workerStatus = "idle";
    },
    moveHead: () => {
      currentHead = "c".repeat(40);
    },
  };
}

test("guide handoff preserves exact revisions, saves through agent tools, and persists progress across reload", async () => {
  const host = await setup();
  let harness = host.harness;

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    const context = await harness.behavior.runCli(["guide-context", url], { threadId: "t1" });
    expect(context.exitCode).toBe(0);
    expect(context.stdout).toContain(head);
    expect(context.stdout).toContain("api.test.ts");
    const request = await harness.behavior.callRpc("guideRequest", target);
    const { id } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(request);

    const provider = harness.inspection.registrations.mentionProviders.find(
      (p) => p.id === "review-comment",
    );

    expect(JSON.stringify(await provider?.resolve(id))).toContain("save_review_guide");
    await harness.behavior.callAgentTool(
      "save_review_guide",
      { url, base, head, guideJson: JSON.stringify(guide) },
      { threadId: "t1" },
    );

    const saved = Schema.decodeUnknownSync(savedGuideSchema)(
      await harness.behavior.callRpc("guideGet", target),
    );

    expect(saved.reviewed).toEqual([false, false]);
    await harness.behavior.callRpc("guideProgress", {
      ...target,
      id: saved.id,
      chapter: 0,
      reviewed: true,
    });
    ({ harness } = await harness.lifecycle.reload(plugin));

    const reloaded = Schema.decodeUnknownSync(savedGuideSchema)(
      await harness.behavior.callRpc("guideGet", target),
    );

    expect(reloaded.reviewed).toEqual([true, false]);
    expect(reloaded.guide).toEqual(guide);
    await expect(
      harness.behavior.callRpc("guideGet", { ...target, threadId: "other" }),
    ).rejects.toThrow(/not linked/);
    await harness.behavior.callRpc("linkedUnlink", target);
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    expect(await harness.behavior.callRpc("guideGet", target)).toBeNull();
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("invalid coverage, blank explanations, stale revisions, and stale progress cannot replace a valid guide", async () => {
  const { harness, moveHead } = await setup();

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });

    const save = (value: typeof guide) =>
      harness.behavior.callAgentTool(
        "save_review_guide",
        { url, base, head, guideJson: JSON.stringify(value) },
        { threadId: "t1" },
      );

    await save(guide);

    const original = Schema.decodeUnknownSync(savedGuideSchema)(
      await harness.behavior.callRpc("guideGet", target),
    );

    for (const invalid of [
      { ...guide, unplacedFiles: [] },
      { ...guide, unplacedFiles: ["api.ts", "api.test.ts"] },
      { ...guide, unplacedFiles: ["outside.ts"] },
      { ...guide, intent: "   " },
    ])
      await expect(save(invalid)).rejects.toThrow();
    await expect(
      harness.behavior.callRpc("guideProgress", {
        ...target,
        id: original.id,
        chapter: 2,
        reviewed: true,
      }),
    ).rejects.toThrow(/Unknown/);
    expect(await harness.behavior.callRpc("guideGet", target)).toEqual(original);
    await save(guide);
    await expect(
      harness.behavior.callRpc("guideProgress", {
        ...target,
        id: original.id,
        chapter: 0,
        reviewed: true,
      }),
    ).rejects.toThrow(/replaced/);
    moveHead();
    await expect(save(guide)).rejects.toThrow(/changed during generation/);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("guide model defaults prefer project over plugin over thread", async () => {
  const host = await setup();
  const { harness } = host;
  const model = { providerId: "codex", model: "plugin-model", reasoningLevel: "high" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    expect(await harness.behavior.callRpc("guideOptions", { threadId: "t1" })).toMatchObject({
      source: "thread",
      model: { providerId: "codex", model: "thread-model" },
    });
    await harness.behavior.callRpc("guideDefaultsSave", { projectId: null, model });
    expect(await harness.behavior.callRpc("guideOptions", { threadId: "t1" })).toMatchObject({
      source: "plugin",
      model,
    });
    await harness.behavior.callRpc("guideDefaultsSave", {
      projectId: "project",
      model: { ...model, model: "project-model" },
    });
    expect(await harness.behavior.callRpc("guideOptions", { threadId: "t1" })).toMatchObject({
      source: "project",
      model: { model: "project-model" },
    });
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("guide generation spawns a hidden worker with the per-run model", async () => {
  const host = await setup();
  const { harness } = host;
  const model = { providerId: "codex", model: "plugin-model", reasoningLevel: "high" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    await harness.behavior.callRpc("guideDefaultsSave", { projectId: null, model });
    await harness.behavior.callRpc("guideDefaultsSave", {
      projectId: "project",
      model: { ...model, model: "project-model" },
    });
    const runModel = { ...model, model: "run-model", serviceTier: "fast" };
    expect(
      await harness.behavior.callRpc("guideStart", { ...target, model: runModel }),
    ).toMatchObject({ status: "running", workerId: "worker" });
    expect(host.spawned).toHaveLength(1);
    expect(host.spawned[0]).toMatchObject({
      ...runModel,
      visibility: "hidden",
      environment: { type: "reuse", environmentId: "env" },
    });
    expect(JSON.stringify(host.spawned[0])).toContain("Return ONLY the guide JSON");
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("guide generation rejects a second start while a job is active", async () => {
  const host = await setup();
  const { harness } = host;
  const model = { providerId: "codex", model: "plugin-model", reasoningLevel: "high" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    await harness.behavior.callRpc("guideStart", { ...target, model });
    await expect(harness.behavior.callRpc("guideStart", { ...target, model })).rejects.toThrow(
      /already/,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("guide generation recovers completion and preserves project defaults after reload", async () => {
  const host = await setup();
  let harness = host.harness;
  const model = { providerId: "codex", model: "plugin-model", reasoningLevel: "high" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    await harness.behavior.callRpc("guideDefaultsSave", {
      projectId: "project",
      model: { ...model, model: "project-model" },
    });
    await harness.behavior.callRpc("guideStart", { ...target, model });
    ({ harness } = await harness.lifecycle.reload(plugin));
    host.complete();
    expect(await harness.behavior.callRpc("guideJob", target)).toMatchObject({
      status: "complete",
    });
    expect(await harness.behavior.callRpc("guideGet", target)).toMatchObject({ guide });
    expect(host.archived).toEqual(["worker"]);
    expect(host.stopped).toEqual(["worker"]);
    expect(await harness.behavior.callRpc("guideOptions", { threadId: "t1" })).toMatchObject({
      source: "project",
      model: { model: "project-model" },
    });
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("cancelled generation ignores late output and allows a new start", async () => {
  const host = await setup();
  const { harness } = host;
  const model = { providerId: "codex", model: "plugin-model", reasoningLevel: "high" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    await harness.behavior.callRpc("guideStart", { ...target, model });
    await harness.behavior.callRpc("guideCancel", target);
    host.complete();
    expect(await harness.behavior.callRpc("guideJob", target)).toMatchObject({
      status: "cancelled",
    });
    expect(await harness.behavior.callRpc("guideGet", target)).toBeNull();
    expect(await harness.behavior.callRpc("guideStart", { ...target, model })).toMatchObject({
      status: "running",
    });
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("malformed guide output fails without saving and allows a retry", async () => {
  const host = await setup();
  const { harness } = host;
  const model = { providerId: "codex", model: "plugin-model", reasoningLevel: "high" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    await harness.behavior.callRpc("guideStart", { ...target, model });
    host.complete("not JSON");
    expect(await harness.behavior.callRpc("guideJob", target)).toMatchObject({ status: "error" });
    expect(await harness.behavior.callRpc("guideGet", target)).toBeNull();
    expect(await harness.behavior.callRpc("guideStart", { ...target, model })).toMatchObject({
      status: "running",
    });
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("guide generation rejects output for a changed PR revision", async () => {
  const host = await setup();
  const { harness } = host;
  const model = { providerId: "codex", model: "plugin-model", reasoningLevel: "high" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    await harness.behavior.callRpc("guideStart", { ...target, model });
    host.complete();
    host.moveHead();
    expect(await harness.behavior.callRpc("guideJob", target)).toMatchObject({
      status: "error",
      error: expect.stringContaining("PR changed"),
    });
    expect(await harness.behavior.callRpc("guideGet", target)).toBeNull();
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("a cancelled slow spawn cannot replace a newer generation", async () => {
  const host = await setup();
  const { harness } = host;
  const model = { providerId: "codex", model: "model", reasoningLevel: "high" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    const gate = host.pauseSpawn();
    const old = harness.behavior.callRpc("guideStart", { ...target, model });
    await gate.started;
    await harness.behavior.callRpc("guideCancel", target);
    const next = await harness.behavior.callRpc("guideStart", { ...target, model });
    gate.resume();
    expect(await old).toMatchObject({ status: "cancelled" });
    expect(await harness.behavior.callRpc("guideJob", target)).toEqual(next);
    expect(host.stopped).toContain("worker");
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("unlink cancels the worker and prevents an old guide from reappearing after relinking", async () => {
  const host = await setup();
  const { harness } = host;
  const model = { providerId: "codex", model: "model", reasoningLevel: "low" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    await harness.behavior.callRpc("guideStart", { ...target, model });
    await harness.behavior.callAgentTool("unlink_pull_request", { url }, { threadId: "t1" });
    expect(host.stopped).toEqual(["worker"]);
    expect(host.archived).toEqual(["worker"]);
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    host.complete();
    expect(await harness.behavior.callRpc("guideJob", target)).toMatchObject({
      status: "cancelled",
    });
    expect(await harness.behavior.callRpc("guideGet", target)).toBeNull();
    expect(await harness.behavior.callRpc("guideStart", { ...target, model })).toMatchObject({
      status: "running",
      workerId: "worker-2",
    });
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("threads without saved model defaults use the environment catalog or fail clearly", async () => {
  const host = await setup();

  try {
    host.clearThreadDefaults();
    expect(await host.harness.behavior.callRpc("guideOptions", { threadId: "t1" })).toMatchObject({
      model: { providerId: "codex", model: "catalog-model", reasoningLevel: "low" },
    });
    expect(host.catalogRequests).toEqual([{ environmentId: "env", providerId: "codex" }]);
    host.clearCatalog();
    await expect(host.harness.behavior.callRpc("guideOptions", { threadId: "t1" })).rejects.toThrow(
      /No model is available/,
    );
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

test("duplicate completion events save only one guide and clean up the hidden worker", async () => {
  const host = await setup();
  const { harness } = host;
  const model = { providerId: "codex", model: "model", reasoningLevel: "low" };

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    await harness.behavior.callRpc("guideStart", { ...target, model });
    host.complete();
    const thread = await host.bb.sdk.threads.get({ threadId: "worker" });
    const event = { thread, lastAssistantText: JSON.stringify(guide) };
    expect(await harness.behavior.emitThreadEvent("thread.idle", event)).toEqual({ errors: [] });
    const saved = await harness.behavior.callRpc("guideGet", target);
    expect(saved).toMatchObject({ guide });
    expect(await harness.behavior.emitThreadEvent("thread.idle", event)).toEqual({ errors: [] });
    expect(await harness.behavior.callRpc("guideGet", target)).toEqual(saved);
    expect(host.stopped).toEqual(["worker"]);
    expect(host.archived).toEqual(["worker"]);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("legacy guide jobs migrate before recovery and remain readable after reload", async () => {
  const host = await setup((bb) => {
    const db = bb.storage.database();
    // Reproduce the previous release's migration history and stored JSON.
    bb.storage.migrate(db, [
      "CREATE TABLE list_snapshots (scope TEXT PRIMARY KEY, data TEXT NOT NULL)",
      "CREATE TABLE linked_prs (thread_id TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id, url))",
      "CREATE TABLE review_comments (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, context TEXT NOT NULL)",
      "CREATE TABLE review_guides (thread_id TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id, url))",
      "CREATE TABLE review_guide_jobs (thread_id TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id, url))",
    ]);

    for (const status of ["preparing", "running", "complete", "error", "cancelled"]) {
      const started = status !== "preparing" && status !== "cancelled";

      const job = {
        id: status,
        threadId: status,
        url,
        status,
        workerId: started ? "worker" : null,
        base: started ? base : "",
        head: started ? head : "",
        error: status === "error" ? "Original error" : "",
      };

      db.prepare("INSERT INTO review_guide_jobs (thread_id, url, data) VALUES (?, ?, ?)").run(
        status,
        url,
        JSON.stringify(job),
      );
    }
  });

  let harness = host.harness;

  try {
    const expected = {
      preparing: {
        id: "preparing",
        threadId: "preparing",
        url,
        status: "error",
        workerId: null,
        error: "Generation was interrupted before starting. Try again.",
        revision: null,
      },
      running: {
        id: "running",
        threadId: "running",
        url,
        status: "running",
        workerId: "worker",
        base,
        head,
      },
      complete: {
        id: "complete",
        threadId: "complete",
        url,
        status: "complete",
        workerId: "worker",
        base,
        head,
      },
      error: {
        id: "error",
        threadId: "error",
        url,
        status: "error",
        workerId: "worker",
        error: "Original error",
        revision: { base, head },
      },
      cancelled: {
        id: "cancelled",
        threadId: "cancelled",
        url,
        status: "cancelled",
        workerId: null,
        revision: null,
      },
    };

    for (const [threadId, job] of Object.entries(expected)) {
      expect(await harness.behavior.callRpc("guideJob", { threadId, url })).toEqual(job);
    }

    ({ harness } = await harness.lifecycle.reload(plugin));

    for (const [threadId, job] of Object.entries(expected)) {
      expect(await harness.behavior.callRpc("guideJob", { threadId, url })).toEqual(job);
    }
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("guide-save CLI keeps URL, revisions, and JSON intact with --json in any position", async () => {
  const { harness } = await setup();

  try {
    await harness.behavior.callRpc("linkedLink", { ...target, reason: "manual" });
    const args = ["guide-save", url, base, head, JSON.stringify(guide)];

    for (let position = 0; position <= args.length; position++) {
      const argv = [...args];
      argv.splice(position, 0, "--json");
      const result = await harness.behavior.runCli(argv, { threadId: target.threadId });
      expect(result.exitCode).toBe(0);
      expect(await harness.behavior.callRpc("guideGet", target)).toMatchObject({
        base,
        head,
        guide,
      });
    }

    expect((await harness.behavior.runCli(args)).exitCode).toBe(1);
    expect(
      (await harness.behavior.runCli(["guide-save", url, base], { threadId: target.threadId }))
        .exitCode,
    ).toBe(1);
  } finally {
    await harness.lifecycle.dispose();
  }
});
