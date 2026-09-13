// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { sideThreadContract } from "../../src/shared/side-thread-contract";

const app = await loadPluginApp(() => import("../../src/ui/app"));

const action = app.composerCustomizations[0]!.actions![0]!;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("promotes the embedded side chat once, preserves its draft, and opens the same thread", async () => {
  let finish!: (value: { threadId: string }) => void;

  const promotion = new Promise<{ threadId: string }>((resolve) => {
    finish = resolve;
  });

  const slot = renderSlot<Record<string, never>, typeof sideThreadContract>(
    action,
    {},
    {
      // ThreadChat's scope belongs to the embedded child, not the page's parent.
      context: { threadId: "parent", projectId: "project" },
      composer: { scope: { kind: "thread", threadId: "side" }, text: "Unsent draft" },
      rpc: {
        side_thread_status: () => ({ canPromote: true }),
        side_thread_promote: () => promotion,
      },
    },
  );

  fireEvent.click(await slot.findByRole("button", { name: "Promote to sidebar" }));
  const pending = await slot.findByRole("button", { name: "Promoting…" });
  expect(pending.hasAttribute("disabled")).toBe(true);
  fireEvent.click(pending);
  expect(slot.inspection.rpcCalls.filter((call) => call.method === "side_thread_promote")).toEqual([
    { method: "side_thread_promote", input: { threadId: "side" } },
  ]);
  expect(slot.inspection.navigateCalls).toEqual([]);
  await act(async () => finish({ threadId: "side" }));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "side" }]);
  expect(slot.queryByRole("button")).toBeNull();
  expect(slot.inspection.composer.text).toBe("Unsent draft");
});

test("failed promotion can be retried without navigating away", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let failed = true;

  const slot = renderSlot<Record<string, never>, typeof sideThreadContract>(
    action,
    {},
    {
      composer: { scope: { kind: "thread", threadId: "side" } },
      rpc: {
        side_thread_status: () => ({ canPromote: true }),
        side_thread_promote: () => {
          if (failed) throw new Error("offline");

          return { threadId: "side" };
        },
      },
    },
  );

  fireEvent.click(await slot.findByRole("button", { name: "Promote to sidebar" }));
  await waitFor(() => {
    expect(slot.getByRole("button", { name: "Promote to sidebar" }).hasAttribute("disabled")).toBe(
      false,
    );
  });
  expect(slot.inspection.navigateCalls).toEqual([]);
  failed = false;
  fireEvent.click(slot.getByRole("button", { name: "Promote to sidebar" }));
  await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(1));
});

test("stale side-chat lookups cannot add a promote button to another thread", async () => {
  let finish!: (value: { canPromote: boolean }) => void;

  const lookup = new Promise<{ canPromote: boolean }>((resolve) => {
    finish = resolve;
  });

  const slot = renderSlot<
    Record<string, never>,
    Pick<typeof sideThreadContract, "side_thread_status">
  >(
    action,
    {},
    {
      composer: { scope: { kind: "thread", threadId: "side" } },
      rpc: {
        side_thread_status: (input) => (input.threadId === "side" ? lookup : { canPromote: false }),
      },
    },
  );

  await slot.behavior.setComposerScope({ kind: "thread", threadId: "main" });
  await act(async () => finish({ canPromote: true }));
  expect(slot.queryByRole("button")).toBeNull();
});

test("promotion in another client and reconnect refresh the action", async () => {
  let canPromote = true;

  const slot = renderSlot<
    Record<string, never>,
    Pick<typeof sideThreadContract, "side_thread_status">
  >(
    action,
    {},
    {
      composer: { scope: { kind: "thread", threadId: "side" } },
      rpc: { side_thread_status: () => ({ canPromote }) },
    },
  );

  await slot.findByRole("button", { name: "Promote to sidebar" });
  canPromote = false;
  await slot.behavior.emitRealtime("side-thread-changed", {});
  await waitFor(() => expect(slot.queryByRole("button")).toBeNull());
  canPromote = true;
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  await slot.behavior.setRealtimeConnectionState("connected");
  await slot.findByRole("button", { name: "Promote to sidebar" });
});
