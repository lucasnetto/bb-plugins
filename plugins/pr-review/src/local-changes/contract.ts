import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const changeSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  status: z.string(),
  area: z.enum(["staged", "unstaged", "untracked", "conflict"]),
});

export type Change = z.infer<typeof changeSchema>;

const checkoutSchema = z.object({
  repository: z.string(),
  path: z.string(),
  branch: z.string(),
  current: z.boolean(),
  changes: z.array(changeSchema),
  error: z.string().nullable(),
});

export type Checkout = z.infer<typeof checkoutSchema>;

export const snapshotSchema = z.object({
  root: z.string(),
  checkouts: z.array(checkoutSchema),
  warnings: z.array(z.string()),
});

export type Snapshot = z.infer<typeof snapshotSchema>;

const diffTarget = z.object({
  checkout: z.string(),
  path: z.string(),
  area: z.enum(["staged", "unstaged", "untracked", "conflict", "combined"]),
});

export type DiffTarget = z.infer<typeof diffTarget>;

const diffSchema = z.object({ patch: z.string(), notice: z.string().nullable() });

export type LocalDiff = z.infer<typeof diffSchema>;

export const checkoutDiffSchema = z.array(diffSchema.extend({ path: z.string() }));

export type CheckoutDiff = z.infer<typeof checkoutDiffSchema>;

export const localHostContract = defineRpcContract({
  localCheckoutDiff: {
    input: z.object({ root: z.string(), checkout: z.string() }),
    output: checkoutDiffSchema,
  },
  localSnapshot: { input: z.object({ root: z.string() }), output: snapshotSchema },
  localDiff: { input: diffTarget.extend({ root: z.string() }), output: diffSchema },
});

export const localRpcContract = defineRpcContract({
  localCheckoutDiff: {
    input: z.object({ threadId: z.string(), checkout: z.string() }),
    output: checkoutDiffSchema,
  },
  localSnapshot: { input: z.object({ threadId: z.string() }), output: snapshotSchema },
  localDiff: { input: diffTarget.extend({ threadId: z.string() }), output: diffSchema },
});
