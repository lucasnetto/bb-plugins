import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const viewSchema = z.enum(["authored", "reviewing"]);
export const listInput = z.object({ view: viewSchema, page: z.number().int().min(1).max(20) });
export const prUrl = z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/);
export const pullRequestSchema = z.object({
  url: prUrl,
  repository: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  author: z.string(),
  isDraft: z.boolean(),
  updatedAt: z.string(),
});
export const listOutput = z.object({
  viewer: z.string(),
  rows: z.array(pullRequestSchema),
  total: z.number().int().nonnegative(),
  nextPage: z.number().int().nullable(),
  incomplete: z.boolean(),
});
export const workspaceSchema = z.object({
  root: z.string(),
  hostId: z.string(),
  projectId: z.string(),
  name: z.string(),
});
export const reviewOutput = z.object({ threadId: z.string(), warning: z.string().nullable() });
export const rpcContract = defineRpcContract({
  list: { input: listInput, output: listOutput },
  review: { input: z.object({ url: prUrl }), output: reviewOutput },
});
export const hostContract = defineRpcContract({
  list: { input: listInput.extend({ root: z.string() }), output: listOutput },
});
export type View = z.infer<typeof viewSchema>;
export type PullRequest = z.infer<typeof pullRequestSchema>;
export type ListResult = z.infer<typeof listOutput>;
