// @vitest-environment node
import { expect, it } from "vite-plus/test";
import { customFontSchema, fontSettingsSchema, resolveFonts } from "../../src/shared/fonts";

it("decodes each saved font independently and retains valid overrides", () => {
  const settings = fontSettingsSchema.parse({
    interfaceFont: 23,
    customInterfaceFont: { family: "Arial" },
    codeFont: "Menlo",
    customCodeFont: null,
  });

  expect(resolveFonts(settings)).toEqual({ ui: undefined, code: "Menlo, monospace" });
  expect(resolveFonts(fontSettingsSchema.parse(undefined))).toEqual({
    ui: undefined,
    code: undefined,
  });
});

it("validates custom families without accepting CSS, URLs or non-string values", () => {
  for (const family of ["Avenir Next", "Noto Sans 日本語", "", "A".repeat(100)]) {
    expect(customFontSchema.safeParse(family).success).toBe(true);
  }

  for (const family of [
    "A".repeat(101),
    "url(https://example.com/font)",
    'A"; color: red',
    23,
    null,
    ["Arial"],
  ]) {
    expect(customFontSchema.safeParse(family).success).toBe(false);
  }
});
