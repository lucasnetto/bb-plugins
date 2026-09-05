import { linkedContentsInput, linkedContentsSchema, linkedPrSchema, linkedDetailSchema, prSummarySchema, threadInput, linkInput } from "./links-contract";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const repoInput = z.object({ repo: z.string().min(1) });
const rootInput = z.object({ root: z.string().min(1) });
export const changeSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  index: z.string(),
  worktree: z.string(),
});
export const repoSchema = z.object({
  name: z.string(),
  branch: z.string(),
  remote: z.string().nullable(),
  changes: z.number(),
  error: z.string().nullable(),
});
export const prSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  isDraft: z.boolean(),
  author: z.string(),
});
export const detailInput = repoInput.extend({
  path: z.string().min(1),
  mode: z.enum(["staged", "worktree", "source"]),
});
export const detailSchema = z.object({
  path: z.string(),
  content: z.string().nullable(),
  patch: z.string().nullable(),
  notice: z.string().nullable(),
});
export const prFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  patch: z.string().nullable(),
});
export const hostContract = defineRpcContract({
  linkedContents: {input:rootInput.merge(linkedContentsInput), output:linkedContentsSchema},
  linkedSummary: { input: rootInput.extend({ url: z.string() }), output: prSummarySchema },
  linkedDetail: { input: rootInput.extend({ url: z.string() }), output: linkedDetailSchema },
  discover: { input: rootInput, output: z.array(repoSchema) },
  changes: { input: rootInput.merge(repoInput), output: z.array(changeSchema) },
  files: { input: rootInput.merge(repoInput), output: z.array(z.string()) },
  detail: { input: rootInput.merge(detailInput), output: detailSchema },
  prs: { input: rootInput.merge(repoInput), output: z.array(prSchema) },
  prFiles: {
    input: rootInput
      .merge(repoInput)
      .extend({ number: z.number().int().positive() }),
    output: z.array(prFileSchema),
  },
  reviewTarget: {
    input: rootInput
      .merge(repoInput)
      .extend({ number: z.number().int().positive() }),
    output: z.object({ path: z.string(), remote: z.string(), pr: prSchema }),
  },
});
export const reviewCommentInput = z.object({ threadId:z.string().min(1), url:z.string(), label:z.string().min(1).max(500), context:z.string().min(1).max(200000) });
export const rpcContract = defineRpcContract({
  stageReviewComment: {input:reviewCommentInput, output:z.object({id:z.string()})},
  linkedContents: {input:threadInput.merge(linkedContentsInput), output:linkedContentsSchema},
  linkedList: { input: threadInput, output: z.array(linkedPrSchema) },
  linkedLink: { input: threadInput.merge(linkInput), output: linkedPrSchema },
  linkedUnlink: { input: threadInput.extend({ url: z.string() }), output: z.object({ removed: z.boolean() }) },
  linkedDetail: { input: threadInput.extend({ url: z.string() }), output: linkedDetailSchema },
  workspace: {
    input: z.null(),
    output: z.object({
      root: z.string(),
      hostId: z.string(),
      projectId: z.string(),
      name: z.string(),
    }),
  },
  discover: { input: z.null(), output: z.array(repoSchema) },
  changes: { input: repoInput, output: z.array(changeSchema) },
  files: { input: repoInput, output: z.array(z.string()) },
  detail: { input: detailInput, output: detailSchema },
  prs: { input: repoInput, output: z.array(prSchema) },
  prFiles: {
    input: repoInput.extend({ number: z.number().int().positive() }),
    output: z.array(prFileSchema),
  },
  review: {
    input: repoInput.extend({ number: z.number().int().positive() }),
    output: z.object({ threadId: z.string() }),
  },
});
export type Repo = z.infer<typeof repoSchema>;
export type Change = z.infer<typeof changeSchema>;
export type PullRequest = z.infer<typeof prSchema>;
export type Detail = z.infer<typeof detailSchema>;
export type PrFile = z.infer<typeof prFileSchema>;
