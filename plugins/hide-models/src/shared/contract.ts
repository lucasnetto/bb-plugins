import { standardSchema } from "./standard-schema";
import { Schema } from "effect";
import { defineRpcContract } from "@get-bb/plugin-sdk";

export const hiddenModelSchema = Schema.Struct({
  providerId: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  // Picker label at the time of hiding; the content script matches rows by
  // display name because bb's picker exposes no model-id DOM attribute.
  displayName: Schema.String.check(Schema.isMinLength(1)),
});

export type HiddenModel = Schema.Schema.Type<typeof hiddenModelSchema>;

const catalogModelSchema = Schema.Struct({
  model: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
  isDefault: Schema.Boolean,
});

const catalogProviderSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  available: Schema.Boolean,
  brandPrefix: Schema.NullOr(Schema.String),
  models: Schema.mutable(Schema.Array(catalogModelSchema)),
  loadError: Schema.NullOr(Schema.String),
});

export type CatalogProvider = Schema.Schema.Type<typeof catalogProviderSchema>;

export const rpcContract = defineRpcContract({
  catalog: {
    input: standardSchema(Schema.Null),
    output: standardSchema(
      Schema.Struct({ providers: Schema.mutable(Schema.Array(catalogProviderSchema)) }),
    ),
  },
  hidden_get: {
    input: standardSchema(Schema.Null),
    output: standardSchema(
      Schema.Struct({ hidden: Schema.mutable(Schema.Array(hiddenModelSchema)) }),
    ),
  },
  hidden_set: {
    input: standardSchema(
      Schema.Struct({
        hidden: Schema.mutable(Schema.Array(hiddenModelSchema)).check(Schema.isMaxLength(500)),
      }),
    ),
    output: standardSchema(
      Schema.Struct({ hidden: Schema.mutable(Schema.Array(hiddenModelSchema)) }),
    ),
  },
});

export const HIDDEN_CHANGED = "hidden-changed";
