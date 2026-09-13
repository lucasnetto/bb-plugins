// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { fireEvent, render } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";

it("renders Bugbot HTML alongside Markdown without exposing hidden markers", async () => {
  installTestPluginRuntime();
  const { GithubMarkdown } = await import("../../src/ui/components/GithubMarkdown");

  const slot = renderSlot(
    { component: GithubMarkdown },
    {
      content: `<!-- BUGBOT_REVIEW -->
Cursor Bugbot found **1 potential issue**.

<!-- BUGBOT_FIX_ALL -->
<a href="https://cursor.com/open?link=review" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/dark.png"><img alt="Fix All in Cursor" width="115" height="28" src="https://cursor.com/light.png"></picture></a>

<sup>Autofix is off. Enable it in the [Cursor dashboard](https://cursor.com/dashboard).</sup>

Comment \`@cursor review\` to trigger another review.

<details><summary>More information</summary>

- A **formatted** detail

</details>`,
    },
    { openUrl: () => true },
  );

  try {
    expect(slot.container.textContent).not.toContain("BUGBOT_");
    expect(slot.container.textContent).not.toContain("<sup>");
    expect(slot.container.querySelector("strong")?.textContent).toBe("1 potential issue");
    const badge = slot.getByRole("img", { name: "Fix All in Cursor" });
    expect(badge.getAttribute("width")).toBe("115");
    expect(badge.closest("picture")?.querySelector("source")?.getAttribute("media")).toBe(
      "(prefers-color-scheme: dark)",
    );
    expect(badge.closest("picture")?.querySelector("source")?.getAttribute("srcset")).toBe(
      "https://cursor.com/dark.png",
    );
    expect(badge.closest("a")?.getAttribute("href")).toBe("https://cursor.com/open?link=review");
    const dashboard = slot.getByRole("link", { name: "Cursor dashboard" });
    expect(dashboard.closest("sup")).toBeTruthy();
    fireEvent.click(dashboard);
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openUrl",
      url: "https://cursor.com/dashboard",
    });
    expect(slot.container.querySelector("details summary")?.textContent).toBe("More information");
    expect(slot.container.querySelector("details strong")?.textContent).toBe("formatted");
  } finally {
    slot.lifecycle.unmount();
  }
});

it("renders GitHub tables, task lists, strikethrough and literal code", async () => {
  installTestPluginRuntime();
  const { GithubMarkdown } = await import("../../src/ui/components/GithubMarkdown");

  const view = render(
    <GithubMarkdown
      content={`## Results

| Check | Result |
| --- | --- |
| Markdown | ~~Broken~~ Fixed |

- [x] Render HTML
- [ ] Ship

1. First
2. Second

\`\`\`html
<sup>Keep code literal</sup>
<!-- Keep this comment -->
\`\`\``}
    />,
  );

  try {
    expect(view.getByRole("heading", { name: "Results" })).toBeTruthy();
    expect(view.getByRole("table").querySelector("del")?.textContent).toBe("Broken");

    const checkboxes = view.getAllByRole("checkbox").map((box) => {
      if (!(box instanceof HTMLInputElement)) throw new Error("Expected checkbox input");

      return box;
    });

    expect(checkboxes.map((box) => box.checked)).toEqual([true, false]);
    expect(checkboxes.every((box) => box.disabled)).toBe(true);
    expect(view.container.querySelectorAll("ol li")).toHaveLength(2);
    expect(view.container.querySelector("pre code")?.textContent).toContain(
      "<sup>Keep code literal</sup>\n<!-- Keep this comment -->",
    );
    expect(view.container.querySelector("pre sup")).toBeNull();
  } finally {
    view.unmount();
  }
});

it("removes active HTML, event handlers, styles and unsafe URLs", async () => {
  installTestPluginRuntime();
  const { GithubMarkdown } = await import("../../src/ui/components/GithubMarkdown");

  const view = render(
    <GithubMarkdown
      content={`<script>alert('script')</script>
<iframe src="https://example.com"></iframe>
<form action="https://example.com"><input name="secret"></form>
<img alt="Unsafe image" src="javascript:alert(1)" onerror="alert(1)">
<a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>
<div id="location" style="position:fixed;inset:0" onmouseover="alert(1)">Safe text</div>

[Unsafe Markdown link](javascript:alert%281%29)

<sup>Safe superscript</sup>`}
    />,
  );

  try {
    expect(view.container.querySelector("script, iframe, form")).toBeNull();
    expect(view.container.querySelector("[onerror], [onclick], [onmouseover], [style]")).toBeNull();
    expect(view.container.querySelector('[href^="javascript:"], [src^="javascript:"]')).toBeNull();
    expect(view.container.querySelector("#location")).toBeNull();
    expect(view.container.querySelector("sup")?.textContent).toBe("Safe superscript");
    expect(view.getByText("Safe text")).toBeTruthy();
  } finally {
    view.unmount();
  }
});
