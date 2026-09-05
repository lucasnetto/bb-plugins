import { expect, test } from "vite-plus/test";
import { thread } from "./thread-fixture";
import { partitionThreads } from "../../src/ui/lib/sidebar-logic";
import { snoozePresets } from "../../src/ui/lib/snooze";

test("snooze overrides pins and old settlement; expiry stays visible until read", () => {
  const input = {
    threads: [{ ...thread, isPinned: true }],
    settledAt: { one: 10 },
    snoozed: { one: { at: 20, until: 100 } },
    scopeProjectId: null,
    autoSettleMs: 10,
    nowMs: 50,
  };
  expect(partitionThreads(input).snoozed).toHaveLength(1);
  expect(partitionThreads({ ...input, nowMs: 100 }).pinned).toHaveLength(1);
  const expired = { ...input, threads: [thread], nowMs: 200 };
  expect(partitionThreads(expired).active).toHaveLength(1);
  expect(
    partitionThreads({ ...expired, threads: [{ ...thread, lastReadAt: 150 }] }).settled,
  ).toHaveLength(1);
  expect(partitionThreads({ ...input, settledAt: { one: 30 } }).settled).toHaveLength(1);
});

test("running completion stays snoozed, pending input is visible, scopes and archives hold", () => {
  const input = {
    threads: [thread],
    settledAt: {},
    snoozed: { one: { at: 20, until: 100 } },
    scopeProjectId: null,
    autoSettleMs: 0,
    nowMs: 50,
  };
  expect(
    partitionThreads({ ...input, threads: [{ ...thread, isUnread: true, latestAttentionAt: 40 }] })
      .snoozed,
  ).toHaveLength(1);
  expect(
    partitionThreads({ ...input, threads: [{ ...thread, hasPendingInteraction: true }] }).active,
  ).toHaveLength(1);
  expect(partitionThreads({ ...input, scopeProjectId: "other" }).snoozed).toHaveLength(0);
  expect(
    partitionThreads({ ...input, threads: [{ ...thread, isArchived: true }] }).snoozed,
  ).toHaveLength(0);
});

test("presets use local calendar days and next Monday, and omit near/past evening", () => {
  const morning = new Date(2026, 3, 6, 10);
  const presets = snoozePresets(morning);
  expect(presets.map((p) => p.id)).toEqual([
    "hour",
    "three-hours",
    "evening",
    "tomorrow",
    "next-week",
  ]);
  expect(new Date(presets[3]!.until)).toEqual(new Date(2026, 3, 7, 9));
  expect(new Date(presets[4]!.until)).toEqual(new Date(2026, 3, 13, 9));
  expect(snoozePresets(new Date(2026, 3, 6, 17, 30)).map((p) => p.id)).not.toContain("evening");
  expect(
    snoozePresets(new Date(2026, 11, 31, 23)).every(
      (p) => p.until > new Date(2026, 11, 31, 23).getTime(),
    ),
  ).toBe(true);
});
