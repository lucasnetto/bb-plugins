import { expect, test } from "vite-plus/test";
import {
  classifyThread,
  resolveThreadStatus,
  resolveTopStatus,
  shouldRecede,
} from "../../src/ui/lib/sidebar-logic";
import { thread } from "./thread-fixture";

test.each(["runtime", "goal", "plan-mode", "unread-error", "unread-success"] as const)(
  "pending interaction overrides %s until answered",
  (indicator) => {
    const running = { ...thread, indicator, isUnread: true };
    const pending = { ...running, hasPendingInteraction: true };
    expect(resolveThreadStatus(pending)).toBe("input");
    expect(resolveThreadStatus({ ...pending, hasPendingInteraction: false })).toBe(
      resolveThreadStatus(running),
    );
  },
);

test("host waiting indicator also shows Input and brings snoozed threads into view", () => {
  const pending = { ...thread, indicator: "waiting-for-input" as const };
  expect(resolveThreadStatus(pending)).toBe("input");
  expect(classifyThread(pending, { snoozed: { one: { at: 0, until: 100 } }, nowMs: 0 })).toBe(
    "active",
  );
});

test("reading or leaving Input never dims it; answering restores the current status", () => {
  for (const isUnread of [false, true]) {
    for (const isActive of [false, true]) {
      expect(shouldRecede({ status: "input", isUnread, isActive })).toBe(false);
      expect(resolveTopStatus({ status: "input", isUnread, isActive })).toMatchObject({
        label: "Input",
        icon: "input",
      });
    }
  }

  expect(resolveThreadStatus(thread)).toBe("ready");
  expect(resolveTopStatus({ status: "ready", isUnread: false, isActive: false })).toBeNull();
  expect(shouldRecede({ status: "working", isUnread: false, isActive: false })).toBe(true);
});
