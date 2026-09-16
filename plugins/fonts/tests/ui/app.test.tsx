import { afterEach, expect, it } from "vite-plus/test";
import { cleanup, render } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { fontSettingsSchema } from "../../src/shared/fonts";

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

it("updates size independently, resets and removes the size override on unmount", async () => {
  await loadPluginApp(() => import("../../src/ui/app"));
  const { FontStyles } = await import("../../src/ui/app");
  const view = render(
    <FontStyles values={{ interfaceFontSize: "20px", codeFontSize: "14px", codeFont: "Menlo" }} />,
  );
  const css = () => document.querySelector("[data-bb-fonts]")?.textContent;
  expect(css()).toContain(":root:root { font-size: 20px !important;");
  expect(css()).toContain(":root pre, :root code { font-size: 14px !important; }");
  expect(css()).toContain(":root diffs-container { --diffs-font-size: 14px !important; }");
  expect(css()).not.toContain("--diffs-line-height");
  view.rerender(<FontStyles values={{ interfaceFontSize: "BB default", codeFontSize: "16px" }} />);
  expect(css()).not.toContain(":root:root");
  expect(css()).toContain("--diffs-font-size: 16px");
  view.rerender(<FontStyles values={{ interfaceFontSize: "18px", codeFontSize: "BB default" }} />);
  expect(css()).toContain("font-size: 18px");
  expect(css()).not.toContain("diffs-container");
  expect(css()).not.toContain(":root pre");
  view.rerender(<FontStyles values={{ interfaceFontSize: "BB default", codeFont: "Menlo" }} />);
  expect(document.querySelector("[data-bb-fonts]")?.textContent).not.toContain("font-size:");
  expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain("--font-mono: Menlo");
  for (const size of [undefined, null, 125, "0px", "999px", "125%; color: red", "125%"]) {
    view.rerender(
      <FontStyles
        values={fontSettingsSchema.parse({ interfaceFontSize: size, codeFontSize: size })}
      />,
    );
    expect(document.querySelector("[data-bb-fonts]")).toBeNull();
  }
  view.rerender(<FontStyles values={{ codeFontSize: "16px" }} />);
  view.unmount();
  expect(document.querySelector("[data-bb-fonts]")).toBeNull();
});

it("loads BB settings in the app-wide owner and the preview", async () => {
  const app = await loadPluginApp(() => import("../../src/ui/app"));

  const settings = {
    interfaceFont: "Custom",
    customInterfaceFont: "Avenir Next",
    codeFont: "Menlo",
    interfaceFontSize: "20px",
    codeFontSize: "14px",
  };

  const live = renderSlot(app.appOverlays[0]!, {}, { settings });
  expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain('"Avenir Next"');
  expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain("font-size: 20px");
  expect(document.querySelector("[data-bb-fonts]")?.textContent).toContain(
    "--diffs-font-size: 14px",
  );
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
    <FontStyles
      values={fontSettingsSchema.parse({
        interfaceFont: 23,
        codeFont: "Custom",
        customCodeFont: "   ",
      })}
    />,
  );
  expect(document.querySelector("[data-bb-fonts]")).toBeNull();
});
