import { afterEach, expect, it } from "vite-plus/test";
import { cleanup, render } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);

it("updates fonts independently and removes overrides on reset and unmount", async () => {
  await loadPluginApp(() => import("../../src/ui/app"));
  const { FontStyles } = await import("../../src/ui/app");
  const theme = document.createElement("style");
  theme.textContent = ':root { --font-sans: "Theme UI"; --font-mono: "Theme Mono"; }';
  document.head.append(theme);
  try {
    const view = render(<FontStyles values={{ interfaceFont: "Georgia", codeFont: "Menlo" }} />);
    expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain(
      "--font-sans: Georgia",
    );
    expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain("--font-mono: Menlo");
    expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain(
      "--diffs-font-family: Menlo",
    );
    expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain(
      "--diffs-header-font-family: Georgia",
    );
    // A theme change must remain visible after removing the plugin's overrides.
    theme.textContent = ':root { --font-sans: "New Theme"; }';
    view.rerender(<FontStyles values={{ interfaceFont: "BB default", codeFont: "Menlo" }} />);
    expect(document.querySelector("[data-bb-fonts]")?.textContent).not.toContain("--font-sans");
    expect(document.querySelector("[data-bb-fonts]")?.textContent).not.toContain(
      "--diffs-header-font-family",
    );
    expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain(
      "--diffs-font-family: Menlo",
    );
    view.rerender(<FontStyles values={{ interfaceFont: "BB default", codeFont: "BB default" }} />);
    expect(document.querySelector("[data-bb-fonts]")).toBeNull();
    expect(theme.textContent).toContain("New Theme");
    view.rerender(<FontStyles values={{ interfaceFont: "Arial" }} />);
    view.unmount();
    expect(document.querySelector("[data-bb-fonts]")).toBeNull();
    expect(theme.isConnected).toBe(true);
  } finally {
    theme.remove();
  }
});

it("loads BB settings in the app-wide owner and the preview", async () => {
  const app = await loadPluginApp(() => import("../../src/ui/app"));
  const settings = {
    interfaceFont: "Custom",
    customInterfaceFont: "Avenir Next",
    codeFont: "Menlo",
  };
  const live = renderSlot(app.appOverlays[0]!, {}, { settings });
  expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain('"Avenir Next"');
  const preview = renderSlot(app.settingsSections[0]!, {}, { settings });
  expect(
    preview.getByText("Make room for your next idea.").parentElement?.style.fontFamily,
  ).toContain("Avenir Next");
  preview.unmount();
  expect(document.querySelector("[data-bb-fonts]")).not.toBeNull();
  live.unmount();
  expect(document.querySelector("[data-bb-fonts]")).toBeNull();
});

it("ignores missing, corrupt and CSS-bearing saved values", async () => {
  await loadPluginApp(() => import("../../src/ui/app"));
  const { FontStyles } = await import("../../src/ui/app");
  const view = render(<FontStyles />);
  expect(document.querySelector("[data-bb-fonts]")).toBeNull();
  view.rerender(
    <FontStyles
      values={{
        interfaceFont: "Custom",
        customInterfaceFont: 'A"; } body { display: none }',
        codeFont: "toString",
      }}
    />,
  );
  expect(document.querySelector("[data-bb-fonts]")).toBeNull();
  view.rerender(
    <FontStyles values={{ interfaceFont: 23, codeFont: "Custom", customCodeFont: "   " }} />,
  );
  expect(document.querySelector("[data-bb-fonts]")).toBeNull();
});
