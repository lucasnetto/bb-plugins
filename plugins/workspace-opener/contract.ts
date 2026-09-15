import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const pathInput = z.object({ path: z.string().min(1).max(32768) }).strict();
export const resolveInput = pathInput.extend({ hostId: z.string().min(1).max(256) });
export const cursorInput = pathInput.extend({
  lineNumber: z.number().int().positive().nullable().optional(),
  columnNumber: z.number().int().positive().nullable().optional(),
});
export const openCursorInput = cursorInput.extend({ hostId: z.string().min(1).max(256) });
export const hostContract = defineRpcContract({
  resolve: { input: pathInput, output: z.string().nullable() },
  openCursor: { input: cursorInput, output: z.object({ opened: z.literal(true) }) },
});
