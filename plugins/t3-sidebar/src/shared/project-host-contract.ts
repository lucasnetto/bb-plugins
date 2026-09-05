import { standardSchema } from "./standard-schema";
import { Schema } from "effect";
import { defineRpcContract } from "@get-bb/plugin-sdk";

export const projectHostContract = defineRpcContract({
  pull: {
    input: standardSchema(
      Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) }).annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
    ),
    output: standardSchema(Schema.Struct({ pulled: Schema.Boolean })),
  },
});
