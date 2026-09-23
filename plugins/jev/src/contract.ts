import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { fixtureId, resultSchema } from "./domain";

export const rpcContract = defineRpcContract({
  list: {
    input: z.object({ threadId: z.string().min(1).max(200).optional() }).strict(),
    output: z.object({
      enabled: z.boolean(),
      fixtureMode: z.boolean(),
      liveEnabled: z.boolean(),
      requireZdr: z.boolean(),
      keyConfigured: z.boolean(),
      requestsToday: z.number(),
      dailyRequestLimit: z.number(),
      issue: z.string().nullable(),
      eligibleThreadIds: z.array(z.string()).max(100),
      results: z.array(resultSchema).max(100),
    }),
  },
  replay: {
    input: z
      .object({ fixture: fixtureId, threadId: z.string().min(1).max(200).optional() })
      .strict(),
    output: z.object({ id: z.string() }),
  },
  check: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ id: z.string() }),
  },
  checkFixture: {
    input: z.object({ fixture: fixtureId }).strict(),
    output: z.object({ id: z.string() }),
  },
  annotate: {
    input: z
      .object({
        id: z.string().max(200),
        revision: z.string().max(200),
        annotation: z.enum(["dismissed", "incorrect"]),
      })
      .strict(),
    output: z.object({ changed: z.boolean() }),
  },
  clear: { input: z.null(), output: z.object({ cleared: z.boolean() }) },
});
