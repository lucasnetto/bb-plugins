// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { mountModelPicker } from "../../src/ui/model-picker.js";

test("collapses legacy presets by full label, preserves selection and restores other providers", async () => {
  document.body.innerHTML = `<div role="dialog">
    <button title="Cursor SDK" class="border-foreground"></button>
    <input role="combobox" />
    <button role="option" id="canonical"><span title="Fable (1M)">Fable</span></button>
    <button role="option" id="legacy" aria-selected="true"><span title="Fable (1M)">Fable</span></button>
    <button role="option" id="context"><span title="Fable (300K)">Fable</span></button>
  </div>`;
  const dispose = mountModelPicker();
  const hidden = () =>
    Array.from(document.querySelectorAll("[data-cursor-sdk-duplicate]")).map((e) => e.id);
  try {
    expect(hidden()).toEqual(["canonical"]);
    document.querySelector("input")!.setAttribute("aria-activedescendant", "canonical");
    await waitFor(() => expect(hidden()).toEqual(["legacy"]));
    document.querySelector('[title="Cursor SDK"]')!.className = "";
    await waitFor(() => expect(hidden()).toEqual([]));
    document.querySelector('[title="Cursor SDK"]')!.className = "border-foreground";
    await waitFor(() => expect(hidden()).toEqual(["legacy"]));
  } finally {
    dispose();
  }
  expect(hidden()).toEqual([]);
  document.body.innerHTML = "";
});
