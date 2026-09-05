import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const hiddenModelSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  // Picker label at the time of hiding; the content script matches rows by
  // display name because bb's picker exposes no model-id DOM attribute.
  displayName: z.string().min(1),
});
export type HiddenModel = z.infer<typeof hiddenModelSchema>;

const catalogModelSchema = z.object({
  model: z.string(),
  displayName: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
});
const catalogProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  available: z.boolean(),
  brandPrefix: z.string().nullable(),
  models: z.array(catalogModelSchema),
  loadError: z.string().nullable(),
});
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;

export const rpcContract = defineRpcContract({
  catalog: {
    input: z.null(),
    output: z.object({ providers: z.array(catalogProviderSchema) }),
  },
  hidden_get: {
    input: z.null(),
    output: z.object({ hidden: z.array(hiddenModelSchema) }),
  },
  hidden_set: {
    input: z.object({ hidden: z.array(hiddenModelSchema).max(500) }),
    output: z.object({ hidden: z.array(hiddenModelSchema) }),
  },
});

export const HIDDEN_CHANGED = "hidden-changed";
