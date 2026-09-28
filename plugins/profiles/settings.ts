import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const url = z.string().refine((value) => {
  if (!value) return true;

  try {
    const parsed = new URL(value);

    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, "Enter an HTTP or HTTPS URL without credentials.");

const localUrl = url.refine((value) => {
  if (!value) return true;

  try {
    const parsed = new URL(value);

    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}, "Use a loopback address for local administration.");

export function defineSettings(bb: BbPluginApi) {
  return bb.settings.define({
    personalHostId: { type: "string", label: "Personal administration machine ID", default: "" },
    workHostId: { type: "string", label: "Work administration machine ID", default: "" },
    personalCliPath: { type: "string", label: "Personal BB CLI path on its machine", default: "" },
    workCliPath: { type: "string", label: "Work BB CLI path on its machine", default: "" },
    personalDataDir: {
      type: "string",
      label: "Personal data directory on its machine",
      default: "",
    },
    workDataDir: { type: "string", label: "Work data directory on its machine", default: "" },
    personalEmail: { type: "string", label: "Personal account label", default: "" },
    personalUrl: {
      type: "string",
      label: "Personal public URL",
      default: "",
      experimental_schema: url,
    },
    personalLocalUrl: {
      type: "string",
      label: "Personal local URL",
      default: "",
      experimental_schema: localUrl,
    },
    workEmail: { type: "string", label: "Work account label", default: "" },
    workUrl: { type: "string", label: "Work public URL", default: "", experimental_schema: url },
    workLocalUrl: {
      type: "string",
      label: "Work local URL",
      default: "",
      experimental_schema: localUrl,
    },
  });
}
