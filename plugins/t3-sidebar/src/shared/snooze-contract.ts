import { standardSchema } from "./standard-schema";
import { Schema } from "effect";

export const SNOOZED_CHANGED = "snoozed-changed";

export const snoozedMapSchema = Schema.Record(
  Schema.String,
  Schema.Struct({ at: Schema.Finite, until: Schema.Finite }),
);

export type SnoozedMap = Schema.Schema.Type<typeof snoozedMapSchema>;

export const snoozeContract = {
  snoozed_list: {
    input: standardSchema(Schema.Null),
    output: standardSchema(Schema.Struct({ snoozed: snoozedMapSchema })),
  },
  snoozed_set: {
    input: standardSchema(
      Schema.Struct({
        threadId: Schema.String.check(Schema.isMinLength(1)),
        until: Schema.NullOr(
          Schema.Finite.check(
            Schema.isInt(),
            Schema.isBetween({
              minimum: Number.MIN_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
            }),
          )
            .check(Schema.isGreaterThanOrEqualTo(0))
            .check(Schema.isLessThanOrEqualTo(8_640_000_000_000_000)),
        ),
      }),
    ),
    output: standardSchema(Schema.Struct({ snoozed: snoozedMapSchema })),
  },
};
