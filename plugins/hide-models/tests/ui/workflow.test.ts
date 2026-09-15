// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { rpcContract, type HiddenModel } from "../../src/shared/contract";

test("settings update the provider-scoped picker filter and disposal restores rows", async () => {
  let hidden: HiddenModel[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ hidden }) })),
  );
  localStorage.clear();
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  const picker = document.createElement("div");
  // Fixture for the host-owned markup consumed by this content script.
  picker.innerHTML = `<div role="dialog">
    <button class="border-foreground"><span data-provider-logo="/api/v1/system/providers/work/logo"></span></button>
    <button id="picker-model"><span title="Example Model">Example Model</span></button>
  </div>`;
  document.body.append(picker);
  const row = picker.querySelector<HTMLButtonElement>("#picker-model")!;
  const providerTab = picker.querySelector("[data-provider-logo]")!;
  const scripts = await mountPluginContentScripts(app, { pluginId: "hide-models", generation: 1 });

  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        catalog: () => ({
          providers: [
            {
              id: "work",
              displayName: "Work",
              available: true,
              brandPrefix: null,
              loadError: null,
              models: [
                {
                  model: "example",
                  displayName: "Example Model",
                  description: "",
                  isDefault: false,
                },
              ],
            },
          ],
        }),
        hidden_get: () => ({ hidden }),
        hidden_set: async (input) => {
          const result = await rpcContract.hidden_set.input["~standard"].validate(input);

          if (result.issues) throw new Error("Invalid hidden models");
          hidden = result.value.hidden;

          return { hidden };
        },
      },
    },
  );

  try {
    fireEvent.click(await slot.findByText("Work", { selector: "h3" }));
    fireEvent.click(await slot.findByRole("checkbox", { name: "Hide Example Model" }));
    await waitFor(() => expect(row.style.display).toBe("none"));
    expect(hidden).toEqual([
      { providerId: "work", model: "example", displayName: "Example Model" },
    ]);
    providerTab.setAttribute("data-provider-logo", "/api/v1/system/providers/personal/logo");
    providerTab.parentElement!.className = "border-foreground personal";
    await waitFor(() => expect(row.style.display).toBe(""));
    providerTab.setAttribute("data-provider-logo", "/api/v1/system/providers/work/logo");
    providerTab.parentElement!.className = "border-foreground";
    await waitFor(() => expect(row.style.display).toBe("none"));
    fireEvent.click(await slot.findByRole("checkbox", { name: "Show Example Model" }));
    await waitFor(() => expect(row.style.display).toBe(""));
    fireEvent.click(await slot.findByRole("checkbox", { name: "Hide Example Model" }));
    await waitFor(() => expect(row.style.display).toBe("none"));
    await scripts.lifecycle.dispose();
    expect(row.style.display).toBe("");
  } finally {
    slot.lifecycle.unmount();
    await scripts.lifecycle.dispose();
    picker.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});

test("hide all saves a provider in one update without removing existing hidden entries", async () => {
  const existing: HiddenModel[] = [
    { providerId: "other", model: "shared", displayName: "Other model" },
    { providerId: "work", model: "old", displayName: "Retired model" },
    { providerId: "work", model: "one", displayName: "One" },
  ];

  let hidden = [...existing];

  const save = vi.fn(async (input: { hidden: HiddenModel[] }) => {
    hidden = input.hidden;

    return { hidden };
  });

  const app = await loadPluginApp(() => import("../../src/ui/app"));

  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        catalog: () => ({
          providers: [
            {
              id: "work",
              displayName: "Work",
              available: true,
              brandPrefix: null,
              loadError: null,
              models: ["one", "two"].map((model) => ({
                model,
                displayName: model === "one" ? "One" : "Two",
                description: "",
                isDefault: model === "two",
              })),
            },
          ],
        }),
        hidden_get: () => ({ hidden }),
        hidden_set: async (input) => {
          const result = await rpcContract.hidden_set.input["~standard"].validate(input);

          if (result.issues) throw new Error("Invalid hidden models");

          return save(result.value);
        },
      },
    },
  );

  try {
    fireEvent.click(await slot.findByText("Work", { selector: "h3" }));
    const button = await slot.findByRole("button", { name: "Hide all Work models" });
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(hidden).toEqual([...existing, { providerId: "work", model: "two", displayName: "Two" }]);
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(slot.getByRole("checkbox", { name: "Show Two" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  } finally {
    slot.lifecycle.unmount();
    localStorage.clear();
  }
});
