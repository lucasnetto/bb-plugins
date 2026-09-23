import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createFakePluginHost,
  makeThreadResponse,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { fileURLToPath } from "node:url";
import plugin from "../server";
import { fixtureEvaluator, fixturePacket, fixtureId, redact, resultSchema } from "../src/domain";
import { Store, migrations } from "../src/store";
import { captureHistory } from "../src/history";
import { z } from "zod";

const cleanup: (() => Promise<void>)[] = [];

function host(settings = {}) {
  const h = createFakePluginHost({ pluginId: "jev", settings });
  cleanup.push(() => h.harness.lifecycle.dispose());

  return h;
}

afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

const snapshot = z.object({
  results: z.array(resultSchema),
  enabled: z.boolean(),
  eligibleThreadIds: z.array(z.string()),
});

async function read(h: ReturnType<typeof host>) {
  const response = await h.harness.behavior.callRpc("list", {});

  return snapshot.parse(response);
}

async function waitResult(h: ReturnType<typeof host>) {
  await expect.poll(async () => (await read(h)).results.length).toBeGreaterThan(0);

  return (await read(h)).results[0]!;
}

function storeFor(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);

  return new Store(db);
}

describe("offline evaluator", () => {
  it.each(fixtureId.options)("replays %s with evidence and no external usage", async (id) => {
    const result = await fixtureEvaluator.evaluate(fixturePacket(id), new AbortController().signal);

    let expected: string | null = null;

    if (id === "decision") expected = "needs_decision";

    if (id === "credentials") expected = "environment_blocked";

    expect(result).toMatchObject({
      execution: "ok",
      label: expected,
      usage: 0,
      evidenceIds: [`fixture:${id}:1`],
    });
  });
  it("abstains on arbitrary text even if a fixture identity is forged", async () => {
    const packet = fixturePacket("decision");
    packet.evidence[0]!.text = "A completely different question?";
    expect(await fixtureEvaluator.evaluate(packet, new AbortController().signal)).toMatchObject({
      execution: "skipped",
      label: null,
    });
  });
  it("cancels and redacts before truncation", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      fixtureEvaluator.evaluate(fixturePacket("decision"), abort.signal),
    ).rejects.toThrow();
    expect(
      redact("api_key=abcdef Bearer abcdef ghp_abcd sk-abcd explicitValue", "explicitValue"),
    ).not.toMatch(/abcdef|ghp_abcd|sk-abcd|explicitValue/);
  });
});

describe("durable store", () => {
  it("migrates idempotently; coalesces jobs; recovers leases; fences revisions", async () => {
    const h = host();
    const store = storeFor(h.bb);
    h.bb.storage.migrate(store.db, migrations);
    const packet = fixturePacket("decision");
    store.touch(packet.subjectId, null, packet.revision, null);
    const id = store.enqueue(packet);
    expect(store.enqueue(packet)).toBe(id);
    const claimed = store.claim()!;
    expect(store.claim()).toBeNull();
    store.recover();
    const recovered = store.claim()!;
    expect(recovered.id).toBe(claimed.id);
    store.invalidate(packet.subjectId);
    expect(
      store.complete(
        recovered,
        await fixtureEvaluator.evaluate(packet, new AbortController().signal),
      ),
    ).toBe(false);
    expect(store.list()).toEqual([]);
  });
  it("annotations apply to an evaluated revision and survive reload", async () => {
    const h = host({ attentionEnabled: true });
    await plugin(h.bb);
    await h.harness.behavior.callRpc("replay", { fixture: "credentials" });
    const service = h.harness.behavior.runService("attention");
    const r = await waitResult(h);

    const response = await h.harness.behavior.callRpc("annotate", {
      id: r.id,
      revision: r.packet.revision,
      annotation: "incorrect",
    });

    expect(response).toEqual({ changed: true });
    service.controller.abort();
    await service.done;
    const next = await h.harness.lifecycle.reload(plugin);
    cleanup.push(() => next.harness.lifecycle.dispose());
    expect((await read(next)).results[0]?.annotation).toBe("incorrect");

    const stale = await next.harness.behavior.callRpc("annotate", {
      id: r.id,
      revision: "other",
      annotation: "dismissed",
    });

    expect(stale).toEqual({ changed: false });
  });
  it("bounds attempts and purges evidence with its subject", () => {
    const h = host();
    const store = storeFor(h.bb);
    const packet = fixturePacket("decision");
    store.touch(packet.subjectId, null, packet.revision, null);
    store.enqueue(packet);

    for (let i = 0; i < 3; i++) {
      const job = store.claim()!;
      expect(job).not.toBeNull();
      store.retry(job);
    }

    expect(store.claim()).toBeNull();
    store.forget(packet.subjectId);
    expect(store.subjects()).toEqual([]);
  });
});

describe("backend registration and lifecycle", () => {
  it("is disabled by default; validates RPC; rejects duplicate registration", async () => {
    const h = host();
    await plugin(h.bb);
    expect((await read(h)).enabled).toBe(false);
    await expect(h.harness.behavior.callRpc("replay", { fixture: "decision" })).rejects.toThrow();
    await expect(
      h.harness.behavior.callRpc("replay", { fixture: "invented", apiKey: "secret" }),
    ).rejects.toThrow();
    await expect(plugin(h.bb)).rejects.toThrow();
  });
  it("runs without credentials, clears on settings changes, excludes secrets and has no mutation calls", async () => {
    const h = host({ attentionEnabled: true, gatewayApiKey: "CANARY_SECRET" });
    await plugin(h.bb);
    await h.harness.behavior.callRpc("replay", { fixture: "decision" });
    h.harness.behavior.runService("attention");
    await waitResult(h);
    expect(JSON.stringify(await read(h))).not.toContain("CANARY_SECRET");
    expect(JSON.stringify(h.harness.inspection.logEntries)).not.toContain("CANARY_SECRET");
    expect(h.harness.inspection.sdk.calls).toEqual([]);
    await h.harness.behavior.setSettings({ attentionEnabled: false });
    expect((await read(h)).results).toEqual([]);
  });
  it("restarts queued work and cleans services on unload", async () => {
    const h = host({ attentionEnabled: true });
    await plugin(h.bb);
    await h.harness.behavior.callRpc("replay", { fixture: "decision" });
    const next = await h.harness.lifecycle.reload(plugin);
    cleanup.push(() => next.harness.lifecycle.dispose());
    const svc = next.harness.behavior.runService("attention");
    await waitResult(next);
    await next.harness.lifecycle.dispose();
    await svc.done;
  });
  it("uses public SDK imports only", async () => {
    const report = experimental_scanPublicSdkOnly(fileURLToPath(new URL("..", import.meta.url)), {
      allow: [
        /^ai$/,
        /^@ai-sdk\/gateway$/,
        /^vite-plus(?:\/test)?$/,
        /^better-sqlite3$/,
        /^react$/,
        /^@testing-library\/react$/,
      ],
    });

    expect(report.violations).toEqual([]);
    expect(report.privateDependencies).toEqual([]);
  });
});

type Event = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>>[number];

function message(seq: number, text: string): Event {
  return {
    id: `event-${seq}`,
    threadId: "t",
    seq,
    createdAt: seq,
    scope: { kind: "thread" },
    type: "item/completed",
    data: {
      providerThreadId: "provider-session",
      item: { id: `item-${seq}`, type: "agentMessage", text },
    },
  };
}

describe("history adapter", () => {
  it("drains string cursors across pages, redacts originals, bounds coverage and preserves environment identity", async () => {
    const events = Array.from({ length: 205 }, (_, i) =>
      message(i + 1, `Original ${i + 1} api_key=secret-value`),
    );

    const h = host();
    const store = storeFor(h.bb);
    h.harness.inspection.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: "t", projectId: "p", environmentId: "remote-environment" }),
    );
    h.harness.inspection.sdk.stub(
      "threads.events.list",
      async (args: Parameters<BbPluginApi["sdk"]["threads"]["events"]["list"]>[0]) =>
        args.order === "desc"
          ? [events.at(-1)!]
          : events.filter((e) => e.seq > Number(args.afterSeq)).slice(0, 100),
    );

    const packet = await captureHistory(
      h.bb.sdk.threads,
      store,
      "t",
      "p",
      256,
      "",
      new AbortController().signal,
    );

    expect(store.subject("t")?.cursor).toBe(205);
    expect(packet?.environmentId).toBe("remote-environment");
    expect(packet?.evidence.map((e) => e.text).join("").length).toBeLessThanOrEqual(256);
    expect(JSON.stringify(packet)).not.toContain("secret-value");
    expect(packet?.omitted).toBeGreaterThan(0);
    const id = store.enqueue(packet!);
    expect(id).toBeTruthy();
    expect(
      await captureHistory(
        h.bb.sdk.threads,
        store,
        "t",
        "p",
        256,
        "",
        new AbortController().signal,
      ),
    ).toBeNull();
    expect((await fixtureEvaluator.evaluate(packet!, new AbortController().signal)).execution).toBe(
      "skipped",
    );
  });
  it("does not advance past missing pages or publish across cancellation", async () => {
    const h = host();
    const store = storeFor(h.bb);
    h.harness.inspection.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: "t", projectId: "p" }),
    );
    h.harness.inspection.sdk.stub(
      "threads.events.list",
      async (args: Parameters<BbPluginApi["sdk"]["threads"]["events"]["list"]>[0]) =>
        args.order === "desc" ? [message(4, "four")] : [],
    );
    await expect(
      captureHistory(h.bb.sdk.threads, store, "t", "p", 256, "", new AbortController().signal),
    ).rejects.toThrow("incomplete");
    expect(store.subject("t")?.cursor).toBe(0);
    const abort = new AbortController();
    abort.abort();
    await expect(
      captureHistory(h.bb.sdk.threads, store, "t", "p", 256, "", abort.signal),
    ).rejects.toThrow();
  });
  it("archive/delete erase local evidence; new input makes a fixture stale", async () => {
    const h = host({ attentionEnabled: true, approvedProject: "p" });

    let thread = makeThreadResponse({
      id: "t",
      projectId: "p",
      status: "idle",
      runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    });

    h.harness.inspection.sdk.stub("threads.get", async () => thread);
    h.harness.inspection.sdk.stub("threads.events.list", async () => []);
    h.harness.inspection.sdk.stub("threads.interactions.list", async () => []);
    await plugin(h.bb);
    await h.harness.behavior.callRpc("replay", { fixture: "decision", threadId: "t" });
    const svc = h.harness.behavior.runService("attention");
    const r = await waitResult(h);
    expect(r.current).toBe(true);
    thread = { ...thread, status: "active", updatedAt: thread.updatedAt + 1 };
    await h.harness.behavior.emitThreadEvent("thread.active", { thread });
    expect((await read(h)).results[0]?.current).toBe(false);
    await h.harness.behavior.emitThreadEvent("thread.deleted", { thread });
    expect((await read(h)).results).toEqual([]);
    svc.controller.abort();
    await svc.done;
  });
});

it("coalesces duplicate notifications and keeps queue and runtime facts ahead of fixture attention", async () => {
  const h = host({ attentionEnabled: true, approvedProject: "p" });

  let thread = makeThreadResponse({
    id: "t",
    projectId: "p",
    status: "idle",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
  });

  h.harness.inspection.sdk.stub("threads.get", async () => thread);
  h.harness.inspection.sdk.stub("threads.events.list", async () => []);
  h.harness.inspection.sdk.stub("threads.interactions.list", async () => []);
  await plugin(h.bb);
  await h.harness.behavior.callRpc("replay", { fixture: "decision", threadId: "t" });
  await h.harness.behavior.emitThreadEvent("thread.idle", {
    thread,
    lastAssistantText: "not used as evidence",
  });
  await h.harness.behavior.emitThreadEvent("experimental_thread.events", { thread, sequence: 0 });
  const svc = h.harness.behavior.runService("attention");
  await waitResult(h);
  expect((await read(h)).eligibleThreadIds).toEqual(["t"]);
  thread = { ...thread, queuedMessageCount: 1 };
  expect((await read(h)).eligibleThreadIds).toEqual([]);
  thread = {
    ...thread,
    queuedMessageCount: 0,
    runtime: { ...thread.runtime, displayStatus: "host-reconnecting" },
  };
  expect((await read(h)).eligibleThreadIds).toEqual([]);
  await h.harness.behavior.emitThreadEvent("thread.idle", {
    thread: { ...thread, updatedAt: thread.updatedAt - 1 },
    lastAssistantText: null,
  });
  expect((await read(h)).results).toHaveLength(1);
  svc.controller.abort();
  await svc.done;
});

it("stops history ingestion when settings change during an outstanding read", async () => {
  const h = host({ attentionEnabled: true, captureEnabled: true, approvedProject: "p" });
  const thread = makeThreadResponse({ id: "t", projectId: "p" });
  h.harness.inspection.sdk.stub("threads.list", async () => [thread]);
  h.harness.inspection.sdk.stub("threads.get", async () => thread);
  let release: () => void = () => {};

  let pending = false;
  h.harness.inspection.sdk.stub("threads.events.list", async () => {
    pending = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });

    return [message(1, "must not survive cancellation")];
  });
  await plugin(h.bb);
  const svc = h.harness.behavior.runService("attention");
  await expect.poll(() => pending).toBe(true);
  await h.harness.behavior.setSettings({ attentionEnabled: false });
  release();
  svc.controller.abort();
  await svc.done;
  expect((await read(h)).results).toEqual([]);
});

it("retains the daily budget across clear and never repeats an interrupted paid request", () => {
  const h = host();
  const store = storeFor(h.bb);
  const packet = fixturePacket("decision");
  store.touch(packet.subjectId, null, packet.revision, null);
  store.enqueue(packet, "gateway");
  const job = store.claim()!;
  expect(store.reserve(job, 2)).not.toBeNull();
  store.recover();
  expect(store.claim()).toBeNull();
  expect(store.list()[0]?.verdict).toMatchObject({ execution: "error", usage: null, label: null });
  store.clear();
  expect(store.requestsToday()).toBe(1);
  store.touch(packet.subjectId, null, packet.revision, null);
  store.enqueue(packet, "gateway");
  const repeated = store.claim()!;
  expect(store.reserve(repeated, 2)).not.toBeNull();
  expect(store.reserve(repeated, 2)).toBeNull();
  expect(store.requestsToday()).toBe(2);
});

it("gates live requests before reading thread content and keeps keys out of RPC", async () => {
  const h = host({
    attentionEnabled: true,
    gatewayApiKey: "live-secret-canary",
    approvedProject: "p",
  });

  await plugin(h.bb);
  await expect(
    h.harness.behavior.callRpc("checkFixture", { fixture: "decision" }),
  ).rejects.toThrow();
  await expect(h.harness.behavior.callRpc("check", { threadId: "t" })).rejects.toThrow();
  expect(h.harness.inspection.sdk.calls).toEqual([]);
  expect(JSON.stringify(await h.harness.behavior.callRpc("list", {}))).not.toContain(
    "live-secret-canary",
  );
});
