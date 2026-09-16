import { z } from "zod";

export const DEFAULT_FONT = "BB default";

export const CUSTOM_FONT = "Custom";

export const INTERFACE_FONT_SIZES = [
  DEFAULT_FONT,
  "12px",
  "13px",
  "14px",
  "15px",
  "16px",
  "17px",
  "18px",
  "19px",
  "20px",
] as const;
// BB's virtual source viewer has a fixed 18px row height. Stay within it:
// changing the CSS line height would desynchronize virtual scrolling metrics.
export const CODE_FONT_SIZES = [
  DEFAULT_FONT,
  "10px",
  "11px",
  "12px",
  "13px",
  "14px",
  "15px",
  "16px",
] as const;
export const interfaceFontSizeSchema = z.enum(INTERFACE_FONT_SIZES);
export const codeFontSizeSchema = z.enum(CODE_FONT_SIZES);

export function resolveFontSize(value: unknown, kind: "interface" | "code"): string | undefined {
  const parsed = (kind === "interface" ? interfaceFontSizeSchema : codeFontSizeSchema).safeParse(
    value,
  );
  return parsed.success && parsed.data !== DEFAULT_FONT ? parsed.data : undefined;
}

export const INTERFACE_FONTS = {
  "System UI": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  Inter: '"Inter", system-ui, sans-serif',
  "Helvetica Neue": '"Helvetica Neue", Helvetica, Arial, sans-serif',
  Arial: "Arial, Helvetica, sans-serif",
  Verdana: "Verdana, Geneva, sans-serif",
  Georgia: "Georgia, Cambria, serif",
};

export const CODE_FONTS = {
  "System monospace": "ui-monospace, monospace",
  "SF Mono": '"SF Mono", Menlo, monospace',
  Menlo: "Menlo, monospace",
  Monaco: "Monaco, monospace",
  Consolas: "Consolas, monospace",
  "Cascadia Code": '"Cascadia Code", monospace',
  "JetBrains Mono": '"JetBrains Mono", monospace',
  "Fira Code": '"Fira Code", monospace',
};

const customFontMessage =
  "Enter one font family (up to 100 characters), using letters, numbers, spaces, dots, underscores, + or -.";

// Accept a single installed family name, never arbitrary CSS or a URL.
export const customFontSchema = z
  .string({ error: customFontMessage })
  .max(100, customFontMessage)
  .regex(/^[\p{L}\p{N} ._+-]*$/u, customFontMessage);

// Saved settings can predate validation. Discard only the invalid field, so a
// corrupt interface setting never prevents a valid code font from applying.
export const fontSettingsSchema = z
  .object({
    interfaceFontSize: interfaceFontSizeSchema.optional().catch(undefined),
    codeFontSize: codeFontSizeSchema.optional().catch(undefined),
    interfaceFont: z.string().optional().catch(undefined),
    customInterfaceFont: customFontSchema.optional().catch(undefined),
    codeFont: z.string().optional().catch(undefined),
    customCodeFont: customFontSchema.optional().catch(undefined),
  })
  .default({});

export type FontSettings = z.infer<typeof fontSettingsSchema>;

export function resolveFont(
  selection: string | undefined,
  custom: string | undefined,
  presets: Readonly<Record<string, string>>,
  fallback: string,
): string | undefined {
  if (selection === CUSTOM_FONT) {
    const family = customFontSchema.safeParse(custom);

    return family.success && family.data.trim() !== ""
      ? `"${family.data.trim()}", ${fallback}`
      : undefined;
  }

  return selection !== undefined && Object.hasOwn(presets, selection)
    ? presets[selection]
    : undefined;
}

export function resolveFonts(values: FontSettings = {}) {
  return {
    ui: resolveFont(
      values.interfaceFont,
      values.customInterfaceFont,
      INTERFACE_FONTS,
      "system-ui, sans-serif",
    ),
    code: resolveFont(
      values.codeFont,
      values.customCodeFont,
      CODE_FONTS,
      "ui-monospace, monospace",
    ),
  };
}
