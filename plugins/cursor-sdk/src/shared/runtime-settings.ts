import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const runtimeSettingsSchema = z.object({ cloudAgents: z.boolean() });
export const RUNTIME_CHANGED = "runtime-default-changed";
export const rpcContract = defineRpcContract({
  runtimeGet: { input: z.object({}), output: runtimeSettingsSchema },
  runtimeSet: { input: runtimeSettingsSchema, output: runtimeSettingsSchema },
});
