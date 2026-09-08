import { Schema } from "effect";

// BB's runtime accepts object validators; Effect v4 schemas are callable values.
export function standardSchema<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  return { "~standard": Schema.toStandardSchemaV1(schema)["~standard"] };
}
