import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const viewSchema = z.enum(["authored", "reviewing"]);
export const stateSchema = z.enum(["ready", "all"]);
const stateInput = stateSchema.optional();
export type PrState = z.infer<typeof stateSchema>;
export const listInput = z.object({
  view: viewSchema,
  state: stateInput,
  page: z.number().int().min(1).max(20),
});
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
export const reviewOutput = z.object({ threadId: z.string(), warning: z.string().nullable() });
export const LIST_CHANGED = "pr-list-changed";
export const snapshotSchema = z.object({
  scope: z.string(),
  view: viewSchema,
  result: listOutput.nullable(),
  fetchedAt: z.number().nullable(),
  pageCount: z.number().int().min(0).max(20),
  error: z.string().nullable(),
});
export type ListSnapshot = z.infer<typeof snapshotSchema>;
export const rpcContract = defineRpcContract({
  list: { input: listInput, output: listOutput },
  savedList: { input: z.object({ view: viewSchema, state: stateInput }), output: snapshotSchema },
  refreshList: {
    input: z.object({
      view: viewSchema,
      state: stateInput,
      force: z.boolean(),
      loadMore: z.boolean(),
    }),
    output: z.null(),
  },
  review: { input: z.object({ url: prUrl }), output: reviewOutput },
});
export const hostContract = defineRpcContract({
  list: { input: listInput, output: listOutput },
});
export type View = z.infer<typeof viewSchema>;
export type PullRequest = z.infer<typeof pullRequestSchema>;
export type ListResult = z.infer<typeof listOutput>;
