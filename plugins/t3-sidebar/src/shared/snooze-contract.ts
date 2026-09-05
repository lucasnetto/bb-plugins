import { z } from "zod";

export const SNOOZED_CHANGED = "snoozed-changed";
export const snoozedMapSchema = z.record(
  z.string(),
  z.object({ at: z.number().finite(), until: z.number().finite() }),
);
export type SnoozedMap = z.infer<typeof snoozedMapSchema>;
export const snoozeContract = {
  snoozed_list: {
    input: z.null(),
    output: z.object({ snoozed: snoozedMapSchema }),
  },
  snoozed_set: {
    input: z.object({
      threadId: z.string().min(1),
      until: z.number().int().min(0).max(8_640_000_000_000_000).nullable(),
    }),
    output: z.object({ snoozed: snoozedMapSchema }),
  },
};
