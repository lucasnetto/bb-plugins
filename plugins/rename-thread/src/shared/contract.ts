import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const statusSchema = z.object({
  status: z.enum(["idle", "running", "renamed", "unchanged", "failed"]),
  title: z.string().nullable(),
  message: z.string().nullable(),
});

export type RenameStatus = z.infer<typeof statusSchema>;

export const modelSelectionSchema = z
  .object({
    providerId: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(200),
    reasoningLevel: z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]),
    serviceTier: z.enum(["default", "fast"]).optional(),
  })
  .strict();

export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const defaultModelSelection: ModelSelection = {
  providerId: "codex",
  model: "gpt-5.6-luna",
  reasoningLevel: "low",
};

const input = z.object({ threadId: z.string().min(1).max(200) });

export const rpcContract = defineRpcContract({
  start: { input, output: statusSchema },
  status: { input, output: statusSchema },
  getModelSelection: { input: z.object({}), output: modelSelectionSchema },
  setModelSelection: { input: modelSelectionSchema, output: modelSelectionSchema },
});
