import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const projectHostContract = defineRpcContract({
  pull: {
    input: z.object({ path: z.string().min(1) }).strict(),
    output: z.object({ pulled: z.boolean() }),
  },
});
