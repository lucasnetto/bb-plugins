import { standardSchema } from "./standard-schema";
import { Schema } from "effect";
import {
  linkedContentsInput,
  linkedContentsSchema,
  linkedPrSchema,
  linkedDetailSchema,
  prSummarySchema,
  threadInput,
  linkInput,
} from "./links-contract";
import { defineRpcContract } from "@get-bb/plugin-sdk";

export const repoInput = Schema.Struct({ repo: Schema.String.check(Schema.isMinLength(1)) });
const rootInput = Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) });
export const changeSchema = Schema.Struct({
  path: Schema.String,
  oldPath: Schema.NullOr(Schema.String),
  index: Schema.String,
  worktree: Schema.String,
});
export const repoSchema = Schema.Struct({
  name: Schema.String,
  branch: Schema.String,
  remote: Schema.NullOr(Schema.String),
  changes: Schema.Finite,
  error: Schema.NullOr(Schema.String),
});
export const prSchema = Schema.Struct({
  number: Schema.Finite,
  title: Schema.String,
  url: Schema.String,
  headRefName: Schema.String,
  baseRefName: Schema.String,
  isDraft: Schema.Boolean,
  author: Schema.String,
});
export const detailInput = repoInput.pipe(
  Schema.fieldsAssign({
    path: Schema.String.check(Schema.isMinLength(1)),
    mode: Schema.Literals(["staged", "worktree", "source"]),
  }),
);
export const detailSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.NullOr(Schema.String),
  patch: Schema.NullOr(Schema.String),
  notice: Schema.NullOr(Schema.String),
});
export const prFileSchema = Schema.Struct({
  path: Schema.String,
  status: Schema.String,
  patch: Schema.NullOr(Schema.String),
});
export const hostContract = defineRpcContract({
  linkedContents: {
    input: standardSchema(rootInput.pipe(Schema.fieldsAssign(linkedContentsInput.fields))),
    output: standardSchema(linkedContentsSchema),
  },
  linkedSummary: {
    input: standardSchema(rootInput.pipe(Schema.fieldsAssign({ url: Schema.String }))),
    output: standardSchema(prSummarySchema),
  },
  linkedDetail: {
    input: standardSchema(rootInput.pipe(Schema.fieldsAssign({ url: Schema.String }))),
    output: standardSchema(linkedDetailSchema),
  },
  discover: {
    input: standardSchema(rootInput),
    output: standardSchema(Schema.mutable(Schema.Array(repoSchema))),
  },
  changes: {
    input: standardSchema(rootInput.pipe(Schema.fieldsAssign(repoInput.fields))),
    output: standardSchema(Schema.mutable(Schema.Array(changeSchema))),
  },
  files: {
    input: standardSchema(rootInput.pipe(Schema.fieldsAssign(repoInput.fields))),
    output: standardSchema(Schema.mutable(Schema.Array(Schema.String))),
  },
  detail: {
    input: standardSchema(rootInput.pipe(Schema.fieldsAssign(detailInput.fields))),
    output: standardSchema(detailSchema),
  },
  prs: {
    input: standardSchema(rootInput.pipe(Schema.fieldsAssign(repoInput.fields))),
    output: standardSchema(Schema.mutable(Schema.Array(prSchema))),
  },
  prFiles: {
    input: standardSchema(
      rootInput.pipe(Schema.fieldsAssign(repoInput.fields)).pipe(
        Schema.fieldsAssign({
          number: Schema.Finite.check(
            Schema.isInt(),
            Schema.isBetween({
              minimum: Number.MIN_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
            }),
          ).check(Schema.isGreaterThan(0)),
        }),
      ),
    ),
    output: standardSchema(Schema.mutable(Schema.Array(prFileSchema))),
  },
  reviewTarget: {
    input: standardSchema(
      rootInput.pipe(Schema.fieldsAssign(repoInput.fields)).pipe(
        Schema.fieldsAssign({
          number: Schema.Finite.check(
            Schema.isInt(),
            Schema.isBetween({
              minimum: Number.MIN_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
            }),
          ).check(Schema.isGreaterThan(0)),
        }),
      ),
    ),
    output: standardSchema(
      Schema.Struct({ path: Schema.String, remote: Schema.String, pr: prSchema }),
    ),
  },
});
export const reviewCommentInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isMinLength(1)),
  url: Schema.String,
  label: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(500)),
  context: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200000)),
});
export const rpcContract = defineRpcContract({
  stageReviewComment: {
    input: standardSchema(reviewCommentInput),
    output: standardSchema(Schema.Struct({ id: Schema.String })),
  },
  linkedContents: {
    input: standardSchema(threadInput.pipe(Schema.fieldsAssign(linkedContentsInput.fields))),
    output: standardSchema(linkedContentsSchema),
  },
  linkedList: {
    input: standardSchema(threadInput),
    output: standardSchema(Schema.mutable(Schema.Array(linkedPrSchema))),
  },
  linkedLink: {
    input: standardSchema(threadInput.pipe(Schema.fieldsAssign(linkInput.fields))),
    output: standardSchema(linkedPrSchema),
  },
  linkedUnlink: {
    input: standardSchema(threadInput.pipe(Schema.fieldsAssign({ url: Schema.String }))),
    output: standardSchema(Schema.Struct({ removed: Schema.Boolean })),
  },
  linkedDetail: {
    input: standardSchema(threadInput.pipe(Schema.fieldsAssign({ url: Schema.String }))),
    output: standardSchema(linkedDetailSchema),
  },
  workspace: {
    input: standardSchema(Schema.Null),
    output: standardSchema(
      Schema.Struct({
        root: Schema.String,
        hostId: Schema.String,
        projectId: Schema.String,
        name: Schema.String,
      }),
    ),
  },
  discover: {
    input: standardSchema(Schema.Null),
    output: standardSchema(Schema.mutable(Schema.Array(repoSchema))),
  },
  changes: {
    input: standardSchema(repoInput),
    output: standardSchema(Schema.mutable(Schema.Array(changeSchema))),
  },
  files: {
    input: standardSchema(repoInput),
    output: standardSchema(Schema.mutable(Schema.Array(Schema.String))),
  },
  detail: {
    input: standardSchema(detailInput),
    output: standardSchema(detailSchema),
  },
  prs: {
    input: standardSchema(repoInput),
    output: standardSchema(Schema.mutable(Schema.Array(prSchema))),
  },
  prFiles: {
    input: standardSchema(
      repoInput.pipe(
        Schema.fieldsAssign({
          number: Schema.Finite.check(
            Schema.isInt(),
            Schema.isBetween({
              minimum: Number.MIN_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
            }),
          ).check(Schema.isGreaterThan(0)),
        }),
      ),
    ),
    output: standardSchema(Schema.mutable(Schema.Array(prFileSchema))),
  },
  review: {
    input: standardSchema(
      repoInput.pipe(
        Schema.fieldsAssign({
          number: Schema.Finite.check(
            Schema.isInt(),
            Schema.isBetween({
              minimum: Number.MIN_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
            }),
          ).check(Schema.isGreaterThan(0)),
        }),
      ),
    ),
    output: standardSchema(Schema.Struct({ threadId: Schema.String })),
  },
});
export type Repo = Schema.Schema.Type<typeof repoSchema>;
export type Change = Schema.Schema.Type<typeof changeSchema>;
export type PullRequest = Schema.Schema.Type<typeof prSchema>;
export type Detail = Schema.Schema.Type<typeof detailSchema>;
export type PrFile = Schema.Schema.Type<typeof prFileSchema>;
