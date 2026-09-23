import { standardSchema } from "./standard-schema";
import { Schema } from "effect";
import { defineRpcContract } from "@get-bb/plugin-sdk";

export const projectHostContract = defineRpcContract({
  discover: {
    input: standardSchema(
      Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) }).annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
    ),
    output: standardSchema(
      Schema.Struct({
        paths: Schema.Array(Schema.String),
        errors: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
      }),
    ),
  },
  pull: {
    input: standardSchema(
      Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) }).annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
    ),
    output: standardSchema(Schema.Struct({ pulled: Schema.Boolean })),
  },
});
