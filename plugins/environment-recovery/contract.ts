import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const recoveryInput = z.object({
  threadId: z.string().min(1).max(200),
  branch: z.string().trim().min(1).max(500).optional(),
});

export type RecoveryInput = z.infer<typeof recoveryInput>;

export const previewSchema = z.object({
  sourceThreadId: z.string(),
  projectId: z.string(),
  hostId: z.string().nullable(),
  environmentId: z.string().nullable(),
  title: z.string(),
  branch: z.string().nullable(),
  branches: z.array(z.string()),
  available: z.boolean(),
  reason: z.string().nullable(),
});

export type RecoveryPreview = z.infer<typeof previewSchema>;

export const resultSchema = z.object({
  threadId: z.string(),
  sourceThreadId: z.string(),
  branch: z.string(),
  reused: z.boolean(),
});

export type RecoveryResult = z.infer<typeof resultSchema>;

export const rpcContract = defineRpcContract({
  preview: { input: recoveryInput, output: previewSchema },
  recover: { input: recoveryInput, output: resultSchema },
});
