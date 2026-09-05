import { standardSchema } from "./standard-schema";
import { Schema } from "effect";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

import { projectModelSchema } from "./project-settings-contract";
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Validate the RPC envelope here. The host's spawn boundary owns the detailed
// environment and prompt schemas, including mentions and attachment variants.
const requestSchema = projectModelSchema
  .pipe(
    Schema.fieldsAssign({
      projectId: Schema.String.check(Schema.isMinLength(1)),
      permissionMode: Schema.Literals(["accept-edits", "auto", "full"]),
      executionInputSources: Schema.Struct({
        providerId: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
        model: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
        reasoningLevel: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
        serviceTier: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
        permissionMode: Schema.optionalKey(Schema.Literals(["explicit", "client-preference"])),
      }).annotate({ parseOptions: { onExcessProperty: "error" } }),
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
      ),
      sendAt: Schema.optionalKey(Schema.Finite),
    }),
  )
  .annotate({ parseOptions: { onExcessProperty: "error" } });

export const projectThreadContract = defineRpcContract({
  project_thread_create: {
    input: standardSchema(
      Schema.Struct({ request: requestSchema }).annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
    ),
    output: standardSchema(Schema.Struct({ id: Schema.String })),
  },
});
