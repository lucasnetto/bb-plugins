import { standardSchema } from "./standard-schema";
import { Schema } from "effect";
import { settledContract } from "./settled-contract";
import { snoozeContract } from "./snooze-contract";
import { defineRpcContract } from "@get-bb/plugin-sdk";

import { projectSettingsContract } from "./project-settings-contract";
import { projectThreadContract } from "./project-thread-contract";
import { sideThreadContract } from "./side-thread-contract";

export const rpcContract = defineRpcContract({
  ...snoozeContract,
  ...projectSettingsContract,
  ...projectThreadContract,
  ...sideThreadContract,
  project_hosts: {
    input: standardSchema(Schema.Null),
    output: standardSchema(
      Schema.mutable(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }))),
    ),
  },
  project_directory: {
    input: standardSchema(
      Schema.Struct({
        hostId: Schema.String.check(Schema.isMinLength(1)),
        path: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
      }),
    ),
    output: standardSchema(
      Schema.Struct({
        directory: Schema.String,
        parent: Schema.NullOr(Schema.String),
        entries: Schema.mutable(
          Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })),
        ),
      }),
    ),
  },
  project_create: {
    input: standardSchema(
      Schema.Struct({
        hostId: Schema.String.check(Schema.isMinLength(1)),
        path: Schema.String.check(Schema.isMinLength(1)),
      }),
    ),
    output: standardSchema(Schema.Struct({ id: Schema.String })),
  },
  project_remove: {
    input: standardSchema(Schema.Struct({ projectId: Schema.String.check(Schema.isMinLength(1)) })),
    output: standardSchema(Schema.Null),
  },
  ...settledContract,
});
