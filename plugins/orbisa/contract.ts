import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { slots } from "./wake.ts";
export const machineSchema = z.object({
  slot: z.enum(slots),
  status: z.enum(["connected", "offline", "starting", "failed", "unbound"]),
});
export type Machine = z.infer<typeof machineSchema>;
export const rpcContract = defineRpcContract({
  list: { input: z.null(), output: z.array(machineSchema) },
  wake: { input: z.object({ slot: z.enum(slots) }), output: z.null() },
});
