import { Schema } from "effect";
import { standardSchema } from "./standard-schema";

export const settledThreadSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  title: Schema.NullOr(Schema.String),
  titleFallback: Schema.NullOr(Schema.String),
  providerId: Schema.String,
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
  archivedAt: Schema.Finite,
});

export type SettledThread = typeof settledThreadSchema.Type;

export const settledContract = {
  settled_list: {
    input: standardSchema(Schema.Null),
    output: standardSchema(
      Schema.Struct({ archivedThreads: Schema.mutable(Schema.Array(settledThreadSchema)) }),
    ),
  },
  settled_set: {
    input: standardSchema(
      Schema.Struct({
        threadId: Schema.String.check(Schema.isMinLength(1)),
        settled: Schema.Boolean,
      }),
    ),
    output: standardSchema(Schema.Null),
  },
};
