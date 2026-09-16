// @vitest-environment jsdom
import { afterEach, expect, it } from "vite-plus/test";
import { hideHeaderCommit } from "../src/ui/lib/hide-header-commit";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.innerHTML = ""; });
const header = (label = "Commit") => `<div data-thread-header-workflow-actions><span data-thread-header-responsive-action><button>${label}</button></span><button>Linked PRs</button></div>`;
const hidden = () => document.querySelectorAll("[data-bb-t3-hide-commit]");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

it("hides only the header Commit control and restores it on disposal", () => {
  document.body.innerHTML = `${header()}<button>Commit</button><div role="dialog"><button>Commit changes</button></div>`;
  dispose = hideHeaderCommit();
  expect(hidden()).toHaveLength(1);
  expect(hidden()[0]?.tagName).toBe("SPAN");
  dispose();
  expect(hidden()).toHaveLength(0);
});

it("handles navigation, split panes, and relabeling without hiding other actions", async () => {
  dispose = hideHeaderCommit();
  document.body.innerHTML = header() + header() + header("Create PR");
  await tick();
  expect(hidden()).toHaveLength(2);
  document.querySelector("button")!.textContent = "Create PR";
  await tick();
  expect(hidden()).toHaveLength(1);
  dispose();
  document.body.innerHTML = header();
  await tick();
  expect(hidden()).toHaveLength(0);
});
