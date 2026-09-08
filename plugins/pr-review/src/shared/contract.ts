import { startReviewInput } from "./review-draft-contract";
import {
  guideStartInput,
  guideJobSchema,
  guideDefaultsInput,
  guideDefaultsSaveInput,
  guideOptionsSchema,
  guideSettingsSchema,
} from "./guide-generation";
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
import { guideTarget, guideProgressInput, savedGuideSchema } from "./guide-contract";

const linkedRootInput = Schema.Struct({
  root: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
});
export const hostContract = defineRpcContract({
  linkedContents: {
    input: standardSchema(linkedRootInput.pipe(Schema.fieldsAssign(linkedContentsInput.fields))),
    output: standardSchema(linkedContentsSchema),
  },
  linkedSummary: {
    input: standardSchema(linkedRootInput.pipe(Schema.fieldsAssign({ url: Schema.String }))),
    output: standardSchema(prSummarySchema),
  },
  linkedDetail: {
    input: standardSchema(linkedRootInput.pipe(Schema.fieldsAssign({ url: Schema.String }))),
    output: standardSchema(linkedDetailSchema),
  },
});
export const reviewCommentInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isMinLength(1)),
  url: Schema.String,
  label: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(500)),
  context: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200000)),
});
export const rpcContract = defineRpcContract({
  reviewDraftDefaults: {
    input: standardSchema(Schema.Null),
    output: standardSchema(Schema.Struct({ projectId: Schema.String, hostId: Schema.String })),
  },
  reviewDraftDetail: {
    input: standardSchema(Schema.Struct({ url: Schema.String })),
    output: standardSchema(linkedDetailSchema),
  },
  reviewDraftContents: {
    input: standardSchema(linkedContentsInput),
    output: standardSchema(linkedContentsSchema),
  },
  startReview: {
    input: standardSchema(startReviewInput),
    output: standardSchema(
      Schema.Struct({ threadId: Schema.String, warning: Schema.NullOr(Schema.String) }),
    ),
  },
  guideStart: { input: standardSchema(guideStartInput), output: standardSchema(guideJobSchema) },
  guideJob: {
    input: standardSchema(guideTarget),
    output: standardSchema(Schema.NullOr(guideJobSchema)),
  },
  guideCancel: { input: standardSchema(guideTarget), output: standardSchema(Schema.Null) },
  guideOptions: { input: standardSchema(threadInput), output: standardSchema(guideOptionsSchema) },
  guideSettings: {
    input: standardSchema(guideDefaultsInput),
    output: standardSchema(guideSettingsSchema),
  },
  guideDefaultsSave: {
    input: standardSchema(guideDefaultsSaveInput),
    output: standardSchema(Schema.Null),
  },
  guideGet: {
    input: standardSchema(guideTarget),
    output: standardSchema(Schema.NullOr(savedGuideSchema)),
  },
  guideRequest: {
    input: standardSchema(guideTarget),
    output: standardSchema(Schema.Struct({ id: Schema.String })),
  },
  guideProgress: {
    input: standardSchema(guideProgressInput),
    output: standardSchema(savedGuideSchema),
  },
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
});
