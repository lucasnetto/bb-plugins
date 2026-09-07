// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ProjectSettings } from "../../../src/shared/project-settings-contract";

const settings: ProjectSettings = {
  id: "p1",
  name: "API",
  hostId: null,
  path: "/workspace/api",
  model: null,
  resolvedModel: null,
  workspace: "default",
  autoPull: false,
};

test("project name saves on blur, ignores overlapping saves, and Escape restores the saved name", async () => {
  const app = await loadPluginApp(() => import("../../../src/ui/app"));
  let finishUpdate!: (settings: ProjectSettings) => void;
  const update = new Promise<ProjectSettings>((resolve) => {
    finishUpdate = resolve;
  });
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "p1" },
    {
      rpc: {
        project_settings_get: () => settings,
        project_settings_update: () => update,
      },
    },
  );
  try {
    const name = await slot.findByRole("textbox", { name: "Project name" });
    fireEvent.change(name, { target: { value: "  Renamed API  " } });
    expect(slot.inspection.rpcCalls).toEqual([
      { method: "project_settings_get", input: { projectId: "p1" } },
    ]);
    // Both events arrive before React can render disabled controls.
    act(() => {
      fireEvent.blur(name);
      fireEvent.blur(name);
    });
    expect(slot.inspection.rpcCalls).toEqual([
      { method: "project_settings_get", input: { projectId: "p1" } },
      { method: "project_settings_update", input: { projectId: "p1", name: "Renamed API" } },
    ]);
    expect(name.hasAttribute("disabled")).toBe(true);
    await act(async () => finishUpdate({ ...settings, name: "Renamed API" }));
    await slot.findByText("Saved", { selector: '[role="status"]' });
    expect((name as HTMLInputElement).value).toBe("Renamed API");
    fireEvent.change(name, { target: { value: "Discard me" } });
    fireEvent.keyDown(name, { key: "Escape" });
    fireEvent.blur(name);
    expect((name as HTMLInputElement).value).toBe("Renamed API");
    expect(slot.inspection.rpcCalls).toHaveLength(2);
  } finally {
    slot.lifecycle.unmount();
  }
});

test("failed settings loads can retry and failed saves retain edits for a later save", async () => {
  const app = await loadPluginApp(() => import("../../../src/ui/app"));
  let reads = 0;
  let saves = 0;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "p1" },
    {
      rpc: {
        project_settings_get: () => {
          if (++reads === 1) throw new Error("Load failed");
          return settings;
        },
        project_settings_update: () => {
          if (++saves === 1) throw new Error("Save failed");
          return { ...settings, name: "Retry name" };
        },
      },
    },
  );
  try {
    fireEvent.click(await slot.findByRole("button", { name: "Retry" }));
    const name = await slot.findByRole("textbox", { name: "Project name" });
    fireEvent.change(name, { target: { value: "Retry name" } });
    fireEvent.blur(name);
    expect((await slot.findByRole("alert")).textContent).toContain("Save failed");
    expect((name as HTMLInputElement).value).toBe("Retry name");
    expect(name.hasAttribute("disabled")).toBe(false);
    fireEvent.blur(name);
    await slot.findByText("Saved", { selector: '[role="status"]' });
    expect(slot.queryByRole("alert")).toBeNull();
    expect(reads).toBe(2);
    expect(saves).toBe(2);
  } finally {
    slot.lifecycle.unmount();
  }
});

test("removal requires confirmation, stays open while pending, and retries errors before navigating", async () => {
  const app = await loadPluginApp(() => import("../../../src/ui/app"));
  let failRemoval!: (error: Error) => void;
  const removal = new Promise<null>((_resolve, reject) => {
    failRemoval = reject;
  });
  let removes = 0;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "p1" },
    {
      rpc: {
        project_settings_get: () => settings,
        project_remove: () => (++removes === 1 ? removal : null),
      },
    },
  );
  try {
    fireEvent.click(await slot.findByRole("button", { name: "Remove project" }));
    expect((await slot.findByRole("dialog")).textContent).toContain("Remove “API”");
    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
    expect(removes).toBe(0);
    fireEvent.click(slot.getByRole("button", { name: "Remove project" }));
    fireEvent.click(await slot.findByRole("button", { name: "Confirm removal" }));
    expect((await slot.findByRole("button", { name: "Removing…" })).hasAttribute("disabled")).toBe(
      true,
    );
    expect(slot.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(slot.getByRole("dialog"), { key: "Escape" });
    expect(slot.getByRole("dialog")).toBeTruthy();
    expect(slot.inspection.navigateCalls).toEqual([]);
    await act(async () => failRemoval(new Error("Remove failed")));
    expect((await slot.findByRole("alert")).textContent).toContain("Remove failed");
    fireEvent.click(slot.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toEqual([
        { method: "toPluginPanel", path: "projects" },
      ]),
    );
    expect(slot.inspection.rpcCalls).toEqual([
      { method: "project_settings_get", input: { projectId: "p1" } },
      { method: "project_remove", input: { projectId: "p1" } },
      { method: "project_remove", input: { projectId: "p1" } },
    ]);
  } finally {
    slot.lifecycle.unmount();
  }
});
