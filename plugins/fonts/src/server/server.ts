import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CODE_FONTS,
  CUSTOM_FONT,
  DEFAULT_FONT,
  INTERFACE_FONTS,
  customFontSchema,
} from "../shared/fonts";

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
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
