// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../app"));

const unmounts: Array<() => void> = [];

afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount());
});

const preset = {
  name: "quick-task",
  description: "Small tasks",
  providerId: "pi",
  model: "test/model",
  reasoningLevel: "low",
};

test("plugin settings explain the inherit-only default", async () => {
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    { rpc: { getConfiguration: () => ({ revision: 0, presets: [] }) } },
  );

  unmounts.push(() => slot.lifecycle.unmount());
  await slot.findByText("No presets configured. Workers use inheritance only.");
});

test("edits configured names and descriptions, saves coherent selections and removes presets", async () => {
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        getConfiguration: () => ({ revision: 0, presets: [preset] }),
        saveConfiguration: (input) => input,
      },
    },
  );

  unmounts.push(() => slot.lifecycle.unmount());
  const name = await slot.findByRole("textbox", { name: "Name" });
  fireEvent.change(name, { target: { value: "deep-analysis" } });
  fireEvent.change(slot.getByRole("textbox", { name: /Description/ }), {
    target: { value: "Difficult investigations" },
  });
  fireEvent.click(slot.getByRole("button", { name: "Save presets" }));
  await slot.findByText("Presets saved.");
  expect(slot.inspection.rpcCalls.at(-1)).toMatchObject({
    method: "saveConfiguration",
    input: {
      revision: 0,
      presets: [{ ...preset, name: "deep-analysis", description: "Difficult investigations" }],
    },
  });
  fireEvent.click(slot.getByRole("button", { name: "Remove preset 1" }));
  fireEvent.click(slot.getByRole("button", { name: "Save presets" }));
  await waitFor(() =>
    expect(slot.inspection.rpcCalls.at(-1)).toMatchObject({
      method: "saveConfiguration",
      input: { presets: [] },
    }),
  );
});

test("save errors retain the draft and are shown without claiming success", async () => {
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        getConfiguration: () => ({ revision: 0, presets: [preset] }),
        saveConfiguration: () => {
          throw new Error("Provider unavailable");
        },
      },
    },
  );

  unmounts.push(() => slot.lifecycle.unmount());
  const name = await slot.findByRole("textbox", { name: "Name" });
  fireEvent.change(name, { target: { value: "renamed" } });
  fireEvent.click(slot.getByRole("button", { name: "Save presets" }));
  expect((await slot.findByRole("alert")).textContent).toContain("Provider unavailable");

  if (!(name instanceof HTMLInputElement)) throw new Error("Expected a name input");
  expect(name.value).toBe("renamed");
  expect(slot.queryByText("Presets saved.")).toBeNull();
});
