// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { RUNTIME_CHANGED, type rpcContract } from "../../src/shared/runtime-settings.js";

afterEach(cleanup);

async function fixture(
  set?: (input: { cloudAgents: boolean }) => Promise<{ cloudAgents: boolean }>,
) {
  const app = await loadPluginApp(() => import("../../src/ui/app.js"));
  const customization = app.composerCustomizations[0];
  expect(customization.scopes).toEqual(["new-thread"]);
  expect(customization.banners?.[0].chrome).toBe("bare");
  let cloudAgents = false;
  const view = renderSlot<object, typeof rpcContract>(
    customization.actions![0],
    {},
    {
      composer: { scope: { kind: "new-thread", projectId: "project" }, text: "Keep my prompt" },
      rpc: {
        runtimeGet: () => ({ cloudAgents }),
        runtimeSet: async (input) => {
          const result = set ? await set(input) : input;
          cloudAgents = result.cloudAgents;
          return result;
        },
      },
    },
  );
  await waitFor(() => expect((view.getByRole("switch") as HTMLButtonElement).disabled).toBe(false));
  return view;
}

test("saves the shared runtime and protects submission until the save finishes", async () => {
  let complete!: (input: { cloudAgents: boolean }) => void;
  const view = await fixture(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const button = view.getByRole("switch") as HTMLButtonElement;
  expect(button.textContent).toBe("cloud");
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  expect(view.inspection.composer.inputLocked).toBe(true);
  expect(view.inspection.composer.text).toBe("Keep my prompt");
  await act(async () => complete({ cloudAgents: true }));
  expect(button.getAttribute("aria-checked")).toBe("true");
  expect(view.inspection.composer.inputLocked).toBe(false);
});

test("receives changes from another window and reconciles after reconnecting", async () => {
  const view = await fixture();
  await view.behavior.emitRealtime(RUNTIME_CHANGED, { cloudAgents: true });
  expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  await view.behavior.setRealtimeConnectionState("reconnecting");
  expect((view.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  await view.behavior.setRealtimeConnectionState("connected");
  await waitFor(() => expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("false"));
});

test("failed saves retain the actual runtime and release the composer", async () => {
  const view = await fixture(async () => {
    throw new Error("Offline");
  });
  fireEvent.click(view.getByRole("switch"));
  await view.findByRole("alert");
  expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  expect(view.inspection.composer.inputLocked).toBe(false);
  expect((view.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
});
