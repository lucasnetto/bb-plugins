import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { configurationSchema } from "./presets";

export { WORKERS_CHANGED, PAGE_SIZE } from "./events";

const id = z.string().min(1).max(200);

export const workerSchema = z.object({
  id,
  title: z.string(),
  providerId: z.string(),
  model: z.string().nullable(),
  reasoningLevel: z.string().nullable(),
  status: z.string(),
  hasPendingInteraction: z.boolean(),
  visibility: z.enum(["visible", "hidden"]),
  archived: z.boolean(),
});

export type Worker = z.infer<typeof workerSchema>;

export const rpcContract = defineRpcContract({
  getConfiguration: {
    input: z.object({}).strict(),
    output: configurationSchema,
  },
  saveConfiguration: {
    input: configurationSchema,
    output: configurationSchema,
  },
  list: {
    input: z.object({ threadId: id, offset: z.number().int().min(0) }),
    output: z.object({ workers: z.array(workerSchema), hasMore: z.boolean() }),
  },
});
