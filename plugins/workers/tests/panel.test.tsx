// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Worker } from "../contract";

const app = await loadPluginApp(() => import("../app"));
const unmounts: Array<() => void> = [];
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount());
});
const worker: Worker = {
  id: "luna",
  title: "Inspect plugin",
  providerId: "codex",
  model: "gpt-5.6-luna",
  reasoningLevel: "low",
  status: "idle",
  hasPendingInteraction: false,
  visibility: "hidden",
  archived: false,
};

test("opens a hidden worker in native compact chat with inherited permissions", async () => {
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "parent", params: null },
    {
      rpc: {
        list: () => ({ workers: [worker], hasMore: false }),
      },
    },
  );
  unmounts.push(() => slot.lifecycle.unmount());
  await slot.findByTestId("bb-thread-chat");
  const chat = slot.getByTestId("bb-thread-chat");
  expect(chat.getAttribute("data-thread-id")).toBe("luna");
  expect(chat.getAttribute("data-variant")).toBe("compact");
  expect(chat.getAttribute("data-permission-policy")).toBe("inherit");
  expect(slot.inspection.navigateCalls).toHaveLength(0);
});

test("refreshes only for the current parent and removes deleted selections", async () => {
  let workers = [worker];
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "parent", params: null },
    {
      rpc: { list: () => ({ workers, hasMore: false }) },
    },
  );
  unmounts.push(() => slot.lifecycle.unmount());
  await slot.findByTestId("bb-thread-chat");
  const count = slot.inspection.rpcCalls.length;
  await slot.behavior.emitRealtime("workers-changed", { threadId: "other" });
  expect(slot.inspection.rpcCalls.length).toBe(count);
  workers = [];
  await slot.behavior.emitRealtime("workers-changed", { threadId: "parent" });
  await slot.findByRole("option", { name: "No workers yet" });
  expect(slot.queryByTestId("bb-thread-chat")).toBeNull();
});

test("shows loading errors and recovers on reconnection", async () => {
  let fail = true;
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "parent", params: null },
    {
      rpc: {
        list: () => {
          if (fail) throw new Error("Offline");
          return { workers: [], hasMore: false };
        },
      },
    },
  );
  unmounts.push(() => slot.lifecycle.unmount());
  expect((await slot.findByRole("alert")).textContent).toContain("Offline");
  fail = false;
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  await slot.behavior.setRealtimeConnectionState("connected");
  await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
});

test("switches between workers in a compact picker, including archived workers", async () => {
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "parent", params: null },
    {
      rpc: {
        list: () => ({
          workers: [
            worker,
            { ...worker, id: "archived", title: "Previous worker", archived: true },
          ],
          hasMore: false,
        }),
      },
    },
  );
  unmounts.push(() => slot.lifecycle.unmount());
  await slot.findByTestId("bb-thread-chat");
  expect(slot.queryByRole("checkbox")).toBeNull();
  fireEvent.change(slot.getByRole("combobox", { name: "Select worker" }), {
    target: { value: "archived" },
  });
  expect(slot.getByTestId("bb-thread-chat").getAttribute("data-thread-id")).toBe("archived");
  expect(slot.queryByRole("button", { name: /sidebar/ })).toBeNull();
});
