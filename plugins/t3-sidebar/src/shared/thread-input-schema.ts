import { Effect, Schema } from "effect";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

// The SDK exports these contracts as types only. Validate the full forwarded
// payload here rather than claiming that a discriminator proves its contents.
const mentionResourceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("thread"),
    label: Schema.String,
    projectId: Schema.optionalKey(Schema.String),
    threadId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("project"),
    label: Schema.String,
    projectId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("section"),
    label: Schema.String,
    sectionId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("path"),
    label: Schema.String,
    path: Schema.String,
    entryKind: Schema.Literals(["directory", "file"]),
    source: Schema.Literals(["thread-storage", "workspace"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("command"),
    label: Schema.String,
    name: Schema.String,
    argumentHint: Schema.NullOr(Schema.String),
    origin: Schema.Literals(["builtin", "project", "user"]),
    source: Schema.Literals(["command", "skill"]),
    trigger: Schema.Literal("/"),
  }),
  Schema.Struct({
    kind: Schema.Literal("plugin"),
    label: Schema.String,
    pluginId: Schema.String,
    itemId: Schema.String,
    icon: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
]);

const visibility = Schema.optionalKey(Schema.Literal("agent-only"));

export const promptInputSchema = Schema.mutable(
  Schema.Array(
    Schema.Union([
      Schema.Struct({
        type: Schema.Literal("text"),
        text: Schema.String,
        visibility,
        mentions: Schema.mutable(
          Schema.Array(
            Schema.Struct({
              start: Schema.Number,
              end: Schema.Number,
              resource: mentionResourceSchema,
            }),
          ),
        ).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
      }),
      Schema.Struct({ type: Schema.Literal("image"), url: Schema.String, visibility }),
      Schema.Struct({ type: Schema.Literal("localImage"), path: Schema.String, visibility }),
      Schema.Struct({
        type: Schema.Literal("localFile"),
        path: Schema.String,
        visibility,
        mimeType: Schema.optionalKey(Schema.String),
        name: Schema.optionalKey(Schema.String),
        sizeBytes: Schema.optionalKey(Schema.Number),
      }),
    ]),
  ),
) satisfies Schema.Schema<NewThreadRequest["input"]>;

export const threadEnvironmentSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("reuse"), environmentId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("project-default") }),
  Schema.Struct({
    type: Schema.Literal("host"),
    hostId: Schema.optionalKey(Schema.String),
    workspace: Schema.Union([
      Schema.Struct({ type: Schema.Literal("personal") }),
      Schema.Struct({
        type: Schema.Literal("unmanaged"),
        path: Schema.NullOr(Schema.String),
        branch: Schema.optionalKey(
          Schema.Union([
            Schema.Struct({ kind: Schema.Literal("existing"), name: Schema.String }),
            Schema.Struct({ kind: Schema.Literal("new"), baseBranch: Schema.String }),
          ]),
        ),
      }),
      Schema.Struct({
        type: Schema.Literal("managed-worktree"),
        baseBranch: Schema.Union([
          Schema.Struct({ kind: Schema.Literal("default") }),
          Schema.Struct({ kind: Schema.Literal("named"), name: Schema.String }),
        ]),
      }),
    ]),
  }),
]) satisfies Schema.Schema<NewThreadRequest["environment"]>;
