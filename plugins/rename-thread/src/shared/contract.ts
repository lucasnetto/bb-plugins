import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const statusSchema = z.object({
  status: z.enum(["idle", "running", "renamed", "unchanged", "failed"]),
  title: z.string().nullable(),
  message: z.string().nullable(),
});

export type RenameStatus = z.infer<typeof statusSchema>;

const input = z.object({ threadId: z.string().min(1).max(200) });

export const rpcContract = defineRpcContract({
  start: { input, output: statusSchema },
  status: { input, output: statusSchema },
});
