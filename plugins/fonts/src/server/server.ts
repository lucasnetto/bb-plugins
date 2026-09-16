import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CODE_FONTS,
  CUSTOM_FONT,
  DEFAULT_FONT,
  INTERFACE_FONTS,
  INTERFACE_FONT_SIZES,
  CODE_FONT_SIZES,
  customFontSchema,
} from "../shared/fonts";

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    interfaceFontSize: {
      type: "select",
      label: "Interface size",
      description:
        "Root size in pixels (12–20). Scales rem-based text and spacing, not every label to the same size. Choose BB default to reset.",
      options: [...INTERFACE_FONT_SIZES],
      default: DEFAULT_FONT,
    },
    codeFontSize: {
      type: "select",
      label: "Code size",
      description:
        "Size in pixels for code blocks, inline code, diffs and source previews. Limited to 10–16px to fit BB's fixed source-viewer rows. Choose BB default to reset.",
      options: [...CODE_FONT_SIZES],
      default: DEFAULT_FONT,
    },
    interfaceFont: {
      type: "select",
      label: "Interface font",
      description: "Font for navigation, conversations and controls. Choose BB default to reset.",
      options: [DEFAULT_FONT, ...Object.keys(INTERFACE_FONTS), CUSTOM_FONT],
      default: DEFAULT_FONT,
    },
    customInterfaceFont: {
      type: "string",
      label: "Custom interface font",
      description:
        "Used when Interface font is Custom. Enter an installed family name, such as Avenir Next.",
      experimental_schema: customFontSchema,
      default: "",
    },
    codeFont: {
      type: "select",
      label: "Code font",
      description: "Font for code blocks, diffs and file paths. Choose BB default to reset.",
      options: [DEFAULT_FONT, ...Object.keys(CODE_FONTS), CUSTOM_FONT],
      default: DEFAULT_FONT,
    },
    customCodeFont: {
      type: "string",
      label: "Custom code font",
      description: "Used when Code font is Custom. Enter an installed monospace family name.",
      experimental_schema: customFontSchema,
      default: "",
    },
  });
}
