import { Schema } from "effect";
import { standardSchema } from "./standard-schema";

export const SIDE_THREAD_CHANGED = "side-thread-changed";

const threadInput = standardSchema(
  Schema.Struct({ threadId: Schema.String.check(Schema.isMinLength(1)) }),
);

export const sideThreadContract = {
  side_thread_status: {
    input: threadInput,
    output: standardSchema(Schema.Struct({ canPromote: Schema.Boolean })),
  },
  side_thread_promote: {
    input: threadInput,
    output: standardSchema(Schema.Struct({ threadId: Schema.String })),
  },
};
