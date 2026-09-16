// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, within } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { overview, stack } from "../../workspace-fixture";
import { invalidateWorkspace } from "../../../src/ui/workspace/workspace-cache";

let stylesheet: HTMLStyleElement;
beforeEach(() => {
  invalidateWorkspace();
  stylesheet = document.createElement("style");
  stylesheet.textContent = readFileSync(
    resolve(import.meta.dirname, "../../../src/ui/workspace/workspace.css"),
    "utf8",
  );
  document.head.append(stylesheet);
});
afterEach(() => stylesheet.remove());

it.each([null, "thread-stack"])(
  "switches stack layers from Code in the same review context (%s)",
  async (threadId) => {
    installTestPluginRuntime();
    const { PullRequestDetail } = await import("../../../src/ui/workspace/PullRequestDetail");

    const slot = renderSlot(
      { component: PullRequestDetail },
      { threadId, url: overview.url, code: <textarea aria-label="Draft" defaultValue="Keep me" /> },
      {
        rpc: {
          prOverview: () => overview,
          prStack: () => stack,
          prTimeline: () => ({ entries: [], nextPage: null, truncated: false }),
        },
      },
    );

    try {
      const trigger = await slot.findByRole("button", { name: "Stack #7, layer 2 of 2" });
      fireEvent.mouseDown(slot.getByRole("tab", { name: "Code" }), { button: 0, ctrlKey: false });
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const menu = await within(document.body).findByRole("menu");
      const layers = within(menu).getAllByRole("menuitemradio");
      expect(layers.map((layer) => layer.textContent)).toEqual([
        expect.stringContaining("Fix API"),
        expect.stringContaining("Base layer"),
      ]);
      for (const layer of layers) {
        const glyph = layer.querySelector("span:first-of-type")!;
        const text = layer.querySelector(".pr-stack-option-text")!;
        expect(getComputedStyle(glyph).flexGrow).toBe("0");
        expect(getComputedStyle(text).flexGrow).toBe("1");
        expect(getComputedStyle(layer).textAlign).toBe("left");
      }
      expect(layers[0].getAttribute("aria-checked")).toBe("true");
      expect(layers[1].getAttribute("aria-checked")).toBe("false");
      expect(within(menu).getByText("#41 · base-layer")).toBeTruthy();
      expect(within(menu).getByText("main")).toBeTruthy();
      fireEvent.click(layers[0]);
      expect(slot.inspection.navigateCalls).toEqual([]);
      expect(slot.getByRole("textbox", { name: "Draft" }).getAttribute("aria-label")).toBe("Draft");
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const reopened = await within(document.body).findByRole("menu");
      fireEvent.click(within(reopened).getAllByRole("menuitemradio")[1]);
      expect(slot.inspection.navigateCalls).toEqual([
        threadId
          ? {
              method: "openThreadPanel",
              options: {
                actionId: "linked-prs",
                title: "acme/api #41",
                params: { url: stack.layers[0].url },
              },
            }
          : {
              method: "toPluginPanel",
              path: "prs",
              options: { subPath: "acme/api/41" },
            },
      ]);
      expect(slot.inspection.rpcCalls.some((call) => call.method === "linkedLink")).toBe(false);
    } finally {
      slot.lifecycle.unmount();
    }
  },
);

it("does not show a picker for a non-stacked PR", async () => {
  installTestPluginRuntime();
  const { PullRequestDetail } = await import("../../../src/ui/workspace/PullRequestDetail");

  const slot = renderSlot(
    { component: PullRequestDetail },
    { threadId: null, url: overview.url, code: null },
    {
      rpc: {
        prOverview: () => overview,
        prStack: () => null,
        prTimeline: () => ({ entries: [], nextPage: null, truncated: false }),
      },
    },
  );

  try {
    await slot.findByRole("heading", { name: "Fix API" });
    expect(slot.queryByRole("button", { name: /Stack #/ })).toBeNull();
  } finally {
    slot.lifecycle.unmount();
  }
});
