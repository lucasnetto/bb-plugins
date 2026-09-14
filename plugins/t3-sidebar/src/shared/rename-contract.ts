import { z } from "zod";

// Wire contract with the optional rename-thread plugin; no implementation dependency.
export const renameStatusSchema = z.object({
  status: z.enum(["idle", "running", "renamed", "unchanged", "failed"]),
  title: z.string().nullable(),
  message: z.string().nullable(),
});

export const renameContract = {
  rename_status: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ available: z.boolean(), job: renameStatusSchema.nullable() }),
  },
  rename_start: { input: z.object({ threadId: z.string().min(1) }), output: renameStatusSchema },
};
