import type { StandardSchemaV1 } from "@get-bb/plugin-sdk";

export const DEFAULT_FONT = "BB default";
export const CUSTOM_FONT = "Custom";

export const INTERFACE_FONTS: Readonly<Record<string, string>> = {
  "System UI": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  Inter: '"Inter", system-ui, sans-serif',
  "Helvetica Neue": '"Helvetica Neue", Helvetica, Arial, sans-serif',
  Arial: "Arial, Helvetica, sans-serif",
  Verdana: "Verdana, Geneva, sans-serif",
  Georgia: "Georgia, Cambria, serif",
};

export const CODE_FONTS: Readonly<Record<string, string>> = {
  "System monospace": "ui-monospace, monospace",
  "SF Mono": '"SF Mono", Menlo, monospace',
  Menlo: "Menlo, monospace",
  Monaco: "Monaco, monospace",
  Consolas: "Consolas, monospace",
  "Cascadia Code": '"Cascadia Code", monospace',
  "JetBrains Mono": '"JetBrains Mono", monospace',
  "Fira Code": '"Fira Code", monospace',
};

// Accept a single installed family name, never arbitrary CSS or a URL.
export function isCustomFont(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100 && /^[\p{L}\p{N} ._+-]*$/u.test(value);
}

export const customFontSchema: StandardSchemaV1<string, string> = {
  "~standard": {
    version: 1,
    vendor: "bb-fonts",
    validate: (value) =>
      isCustomFont(value)
        ? { value }
        : {
            issues: [
              {
                message:
                  "Enter one font family (up to 100 characters), using letters, numbers, spaces, dots, underscores, + or -.",
              },
            ],
          },
  },
};

export function resolveFont(
  selection: unknown,
  custom: unknown,
  presets: Readonly<Record<string, string>>,
  fallback: string,
): string | undefined {
  if (selection === CUSTOM_FONT) {
    return isCustomFont(custom) && custom.trim() !== ""
      ? `"${custom.trim()}", ${fallback}`
      : undefined;
  }
  return typeof selection === "string" && Object.hasOwn(presets, selection)
    ? presets[selection]
    : undefined;
}

export function resolveFonts(values: Record<string, unknown> = {}) {
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
