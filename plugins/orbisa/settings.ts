import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export function defineSettings(bb: BbPluginApi) {
  return bb.settings.define({
    awsRegion: {
      type: "string",
      label: "AWS region",
      default: "",
      experimental_schema: z
        .string()
        .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)+)?$/, "Enter an AWS region or leave empty."),
      description: "Region written to environments when AWS credentials are available.",
    },
  });
}

export interface ProfileSettings {
  awsRegion: string;
}
