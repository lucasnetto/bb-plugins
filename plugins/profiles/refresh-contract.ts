import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const maintenanceRequest = z
  .object({
    profile: z.enum(["personal", "work"]),
    action: z.enum(["list", "inspect", "build", "reload", "install", "disable"]),
    argument: z.string().max(32768).default(""),
  })
  .strict();

export const maintenanceTarget = maintenanceRequest.extend({
  url: z.string(),
  dataDir: z.string(),
  cliPath: z.string(),
});

export const maintenanceContract = defineRpcContract({
  maintain: { input: maintenanceTarget, output: z.string() },
});
