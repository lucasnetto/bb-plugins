import { standardSchema } from "./standard-schema";
import { Schema } from "effect";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { promptInputSchema, threadEnvironmentSchema } from "./thread-input-schema";

import { projectModelSchema } from "./project-settings-contract";

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
      environment: threadEnvironmentSchema,
      input: promptInputSchema,
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
