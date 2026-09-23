// @vitest-environment jsdom
import { expect, it, afterEach } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { fixturePacket, fixtureEvaluator, type Result } from "../src/domain";
import { createRowBridge, canShowAttention } from "../src/bridge";

const cleanup: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

const thread: PluginSidebarThread = {
  id: "t",
  projectId: "p",
  title: "Demo",
  titleFallback: null,
  parentThreadId: null,
  sectionId: null,
  originKind: null,
  originPluginId: null,
  providerId: "test",
  hasPendingInteraction: false,
  activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
  indicator: "none",
  indicatorLabel: null,
  isUnread: false,
  isPinned: false,
  isArchived: false,
  environment: null,
  host: null,
  createdAt: 0,
  updatedAt: 0,
  lastReadAt: null,
  latestAttentionAt: 0,
};

async function result(): Promise<Result> {
  const packet = fixturePacket("decision", "t", "t", "p", "r1");

  return {
    id: "result1",
    packet,
    verdict: await fixtureEvaluator.evaluate(packet, new AbortController().signal),
    annotation: null,
    current: true,
    createdAt: 1,
  };
}

it.each(["before", "after"])(
  "syncs when content script mounts %s React bridge, reconnects and clears",
  async (order) => {
    const app = await loadPluginApp(() => import("../app"));

    let scripts =
      order === "before" ? await mountPluginContentScripts(app, { pluginId: "jev" }) : null;

    const results = [await result()];

    const slot = renderSlot(
      app.appOverlays[0]!,
      {},
      {
        rpc: {
          list: () => ({ enabled: true, fixtureMode: true, eligibleThreadIds: ["t"], results }),
        },
        sidebarThreads: { threads: [thread], status: "ready" },
      },
    );

    cleanup.push(() => slot.lifecycle.unmount());
    await waitFor(() => expect(slot.inspection.rpcCalls.length).toBeGreaterThan(0));

    if (!scripts) scripts = await mountPluginContentScripts(app, { pluginId: "jev" });
    const mounted = scripts;
    cleanup.push(() => mounted.lifecycle.dispose());
    await waitFor(() =>
      expect(mounted.inspection.getThreadRowStatus("t")?.label).toBe(
        "Fixture preview: needs decision",
      ),
    );
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    expect(mounted.inspection.getThreadRowStatus("t")).toBeNull();
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(mounted.inspection.getThreadRowStatus("t")).not.toBeNull());
    results[0]!.annotation = "dismissed";
    await slot.behavior.emitRealtime("attention-changed", null);
    await waitFor(() => expect(mounted.inspection.getThreadRowStatus("t")).toBeNull());
    slot.lifecycle.unmount();
    await mounted.lifecycle.dispose();
    expect(mounted.inspection.getThreadRowStatus("t")).toBeNull();
  },
);

it("renders evidence fallback without the setter and writes correction against the revision", async () => {
  const app = await loadPluginApp(() => import("../app"));

  const scripts = await mountPluginContentScripts(app, {
    pluginId: "jev",
    omitExperimentalThreadRowStatus: true,
  });

  cleanup.push(() => scripts.lifecycle.dispose());
  const r = await result();

  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "t", params: null },
    {
      rpc: {
        list: () => ({ enabled: true, fixtureMode: true, eligibleThreadIds: [], results: [r] }),
        annotate: () => ({ changed: true }),
      },
    },
  );

  cleanup.push(() => slot.lifecycle.unmount());
  await slot.findByText("needs decision");
  fireEvent.click(slot.getByText("Evidence and revision"));
  expect(slot.getByText(/Should I use SQLite/)).toBeTruthy();
  expect(slot.getByText(/Exact event scrolling is unavailable/)).toBeTruthy();
  fireEvent.click(slot.getByText("Mark incorrect"));
  await waitFor(() =>
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "annotate",
      input: { id: "result1", revision: "r1", annotation: "incorrect" },
    }),
  );
  fireEvent.click(slot.getByText("Open thread"));
  expect(slot.inspection.navigateCalls.length).toBe(1);
});

it("keeps separate window state and cleans abort listeners and statuses", async () => {
  const a = createRowBridge(),
    b = createRowBridge();

  const r = await result();

  const first = new Map(),
    second = new Map();

  const ac = new AbortController(),
    bc = new AbortController();

  const disposeA = a.mount({
    pluginId: "jev",
    generation: 1,
    signal: ac.signal,
    experimental_setThreadRowStatus: (id, value) => first.set(id, value),
  });

  const disposeB = b.mount({
    pluginId: "jev",
    generation: 1,
    signal: bc.signal,
    experimental_setThreadRowStatus: (id, value) => second.set(id, value),
  });

  a.update([r], [thread], ["t"]);
  b.update([r], [thread], ["t"]);
  ac.abort();
  expect(first.get("t")).toBeNull();
  expect(second.get("t")).not.toBeNull();
  disposeA();
  disposeB();
  expect(second.get("t")).toBeNull();
});

it.each([
  "background-agent",
  "background-command",
  "draft",
  "goal",
  "plan-mode",
  "runtime",
  "unread-error",
  "unread-success",
  "waiting-for-input",
  "workflow",
  "working-draft",
] as const)("preserves native %s indication", (indicator) => {
  expect(canShowAttention({ ...thread, indicator })).toBe(false);
});

it("preserves permission, archive and background counts even without a native indicator", () => {
  expect(canShowAttention({ ...thread, hasPendingInteraction: true })).toBe(false);
  expect(canShowAttention({ ...thread, isArchived: true })).toBe(false);
  expect(
    canShowAttention({ ...thread, activity: { ...thread.activity, backgroundCommands: 1 } }),
  ).toBe(false);
});

it("shows failed live checks honestly and queues an explicit thread check", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const r = await result();
  r.packet.fixture = null;
  r.verdict = {
    execution: "error",
    label: null,
    evidenceIds: [],
    model: "typesafe-ai/jev",
    usage: null,
    uncertainty: "Gateway rejected required ZDR.",
  };

  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "t", params: null },
    {
      rpc: {
        list: () => ({
          enabled: true,
          fixtureMode: false,
          liveEnabled: true,
          requireZdr: true,
          keyConfigured: true,
          requestsToday: 2,
          dailyRequestLimit: 20,
          eligibleThreadIds: [],
          results: [r],
        }),
        check: () => ({ id: "queued" }),
      },
    },
  );

  cleanup.push(() => slot.lifecycle.unmount());
  await slot.findByText("Check failed");
  expect(slot.getByText(/external usage unknown/)).toBeTruthy();
  expect(slot.getByText(/Zero data retention required/)).toBeTruthy();
  fireEvent.click(slot.getByText("Check this thread with Jev"));
  await waitFor(() =>
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "check", input: { threadId: "t" } }),
  );
});
