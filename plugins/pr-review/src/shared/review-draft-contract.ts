import { Schema } from "effect";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Validate the envelope; threads.spawn validates all host-owned request fields.
export const newThreadRequestSchema = Schema.Struct({
  projectId: Schema.String.check(Schema.isMinLength(1)),
  providerId: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoningLevel: Schema.Literals([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
    "ultracode",
  ]),
  serviceTier: Schema.optionalKey(Schema.Literals(["default", "fast"])),
  permissionMode: Schema.Literals(["accept-edits", "auto", "full"]),
  executionInputSources: Schema.Struct({
    providerId: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
    model: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
    reasoningLevel: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
    serviceTier: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
    permissionMode: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
  }),
  environment: Schema.declare<NewThreadRequest["environment"]>(
    (value): value is NewThreadRequest["environment"] =>
      object(value) && ["reuse", "host", "project-default"].includes(String(value.type)),
  ),
  input: Schema.mutable(
    Schema.Array(
      Schema.declare<NewThreadRequest["input"][number]>(
        (value): value is NewThreadRequest["input"][number] =>
          object(value) &&
          ["text", "image", "localImage", "localFile"].includes(String(value.type)),
      ),
    ),
  ).check(Schema.isMinLength(1)),
  sendAt: Schema.optionalKey(Schema.Finite),
});

export const draftCommentSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  label: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(500)),
  text: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(20000)),
  context: Schema.String.check(Schema.isMaxLength(200000)),
});
export type DraftComment = Schema.Schema.Type<typeof draftCommentSchema>;
export const draftCommentsSchema = Schema.mutable(Schema.Array(draftCommentSchema)).check(
  Schema.isMaxLength(100),
);
export const startReviewInput = Schema.Struct({
  url: Schema.String,
  request: newThreadRequestSchema,
  comments: draftCommentsSchema,
});
