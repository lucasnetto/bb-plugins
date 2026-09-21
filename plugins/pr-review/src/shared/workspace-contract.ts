import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{40}$/);

const number = z.number().int().positive();

export const actorSchema = z.object({ login: z.string(), avatarUrl: z.string().nullable() });

export const labelSchema = z.object({ name: z.string(), color: z.string() });

export const checkSchema = z.object({
  name: z.string(),
  state: z.enum(["success", "failure", "pending", "skipped"]),
  url: z.string().nullable(),
});

export const overviewSchema = z.object({
  id: z.string(),
  url: z.string(),
  repository: z.string(),
  number,
  title: z.string(),
  body: z.string(),
  bodyHTML: z.string().optional(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  mergedAt: z.string().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  isDraft: z.boolean(),
  author: actorSchema.nullable(),
  updatedAt: z.string(),
  createdAt: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRefOid: sha,
  baseRefOid: sha,
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  mergeable: z.string(),
  mergeStateStatus: z.string(),
  reviewDecision: z.string().nullable(),
  viewer: z.string(),
  canEdit: z.boolean(),
  canMerge: z.boolean(),
  canUpdateBranch: z.boolean(),
  mergeMethods: z.array(z.enum(["merge", "squash", "rebase"])),
  autoMergeAllowed: z.boolean(),
  autoMerge: z.boolean(),
  labels: z.array(labelSchema),
  reviewers: z.array(z.object({ login: z.string(), kind: z.enum(["user", "team"]) })),
  checks: z.array(checkSchema),
  checksTruncated: z.boolean(),
  commentCount: z.number(),
  checkoutRoot: z.string().nullable(),
});

export const stackLayerSchema = z.object({
  number,
  title: z.string(),
  url: z.string(),
  headRefName: z.string(),
  headRefOid: sha.nullable(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
});

export const stackSchema = z.object({
  number,
  base: z.string(),
  layers: z.array(stackLayerSchema),
});

export const stackHeadsSchema = z.object({
  number,
  base: z.string(),
  heads: z
    .array(z.object({ number, headRefOid: sha }))
    .min(1)
    .max(100),
});

export const activitySchema = z.object({
  id: z.string(),
  kind: z.enum(["comment", "review", "commit", "event"]),
  author: actorSchema.nullable(),
  body: z.string(),
  bodyHTML: z.string().optional(),
  createdAt: z.string(),
  url: z.string().nullable(),
  title: z.string(),
  state: z.string().nullable(),
});

export const timelineSchema = z.object({
  entries: z.array(activitySchema),
  truncated: z.boolean(),
  nextPage: number.nullable(),
});

const text = z.string().max(65000);

export const workspaceActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("merge"),
    method: z.enum(["merge", "squash", "rebase"]),
    auto: z.boolean(),
    stack: stackHeadsSchema.nullable(),
  }),
  z.object({
    kind: z.literal("update-branch"),
    method: z.enum(["merge", "rebase"]),
    stack: stackHeadsSchema.nullable(),
  }),
  z.object({
    kind: z.enum(["close", "reopen", "ready", "draft", "disable-auto-merge", "checkout"]),
  }),
  z.object({
    kind: z.literal("edit"),
    title: z.string().trim().min(1).max(256),
    body: text,
    updatedAt: z.string(),
  }),
  z.object({
    kind: z.literal("labels"),
    labels: z.array(z.string().min(1).max(100)).max(100),
    updatedAt: z.string(),
  }),
  z.object({
    kind: z.literal("reviewers"),
    users: z.array(z.string().regex(/^[\w-]+$/)).max(20),
    teams: z.array(z.string().regex(/^[\w-]+$/)).max(20),
    remove: z.boolean(),
  }),
  z.object({ kind: z.literal("comment"), body: text.trim().min(1) }),
]);

export const actionResultSchema = z.object({
  message: z.string(),
  pendingMergeId: z.string().nullable(),
});

export const mergeStatusSchema = z.object({
  status: z.enum(["pending", "merged", "enqueued", "failed"]),
  details: z.object({ uuid: z.string().optional(), message: z.string().optional() }).passthrough(),
});

const target = z.object({ threadId: z.string().nullable(), url: z.string() });

const hostTarget = z.object({ root: z.string().nullable(), url: z.string() });

const mutation = { head: sha, base: z.string().min(1), action: workspaceActionSchema };

const candidates = z.object({
  labels: z.array(labelSchema),
  users: z.array(actorSchema),
  teams: z.array(z.object({ slug: z.string(), name: z.string() })),
});

export const workspaceRpcContract = defineRpcContract({
  prPrepare: {
    input: target.extend({ wake: z.boolean() }),
    output: z.object({ status: z.enum(["ready", "waking"]) }),
  },
  prOverview: { input: target, output: overviewSchema },
  prTimeline: { input: target.extend({ page: number.default(1) }), output: timelineSchema },
  prStack: { input: target, output: stackSchema.nullable() },
  prCandidates: { input: target, output: candidates },
  prAction: { input: target.extend(mutation), output: actionResultSchema },
  prMergeStatus: {
    input: target.extend({ id: z.string().min(1).max(200) }),
    output: mergeStatusSchema,
  },
});

export const workspaceHostContract = defineRpcContract({
  prOverview: { input: hostTarget, output: overviewSchema },
  prTimeline: { input: hostTarget.extend({ page: number.default(1) }), output: timelineSchema },
  prStack: { input: hostTarget, output: stackSchema.nullable() },
  prCandidates: { input: hostTarget, output: candidates },
  prAction: { input: hostTarget.extend(mutation), output: actionResultSchema },
  prMergeStatus: {
    input: hostTarget.extend({ id: z.string().min(1).max(200) }),
    output: mergeStatusSchema,
  },
});

export type Overview = z.infer<typeof overviewSchema>;

export type PrStack = z.infer<typeof stackSchema>;

export type StackHeads = z.infer<typeof stackHeadsSchema>;

export type Activity = z.infer<typeof activitySchema>;

export type Timeline = z.infer<typeof timelineSchema>;

export type WorkspaceAction = z.infer<typeof workspaceActionSchema>;

export type ActionResult = z.infer<typeof actionResultSchema>;

export type Check = z.infer<typeof checkSchema>;

export type Actor = z.infer<typeof actorSchema>;
