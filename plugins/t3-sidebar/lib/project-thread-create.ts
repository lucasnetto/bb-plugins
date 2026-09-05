import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { projectModelSchema } from "./project-settings";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Validate the RPC envelope here. The host's spawn boundary owns the detailed
// environment and prompt schemas, including mentions and attachment variants.
const requestSchema = projectModelSchema
  .extend({
    projectId: z.string().min(1),
    permissionMode: z.enum(["accept-edits", "auto", "full"]),
    executionInputSources: z
      .object({
        providerId: z.enum(["explicit", "client-preference"]).optional(),
        model: z.enum(["explicit", "client-preference"]).optional(),
        reasoningLevel: z.enum(["explicit", "client-preference"]).optional(),
        serviceTier: z.enum(["explicit", "client-preference"]).optional(),
        permissionMode: z.enum(["explicit", "client-preference"]).optional(),
      })
      .strict(),
    environment: z.custom<NewThreadRequest["environment"]>(
      (value) => object(value) && ["reuse", "host", "project-default"].includes(String(value.type)),
    ),
    input: z.array(
      z.custom<NewThreadRequest["input"][number]>(
        (value) =>
          object(value) &&
          ["text", "image", "localImage", "localFile"].includes(String(value.type)),
      ),
    ),
    sendAt: z.number().finite().optional(),
  })
  .strict();

export const projectThreadContract = defineRpcContract({
  project_thread_create: {
    input: z.object({ request: requestSchema }).strict(),
    output: z.object({ id: z.string() }),
  },
});

export function createProjectThreadHandlers(bb: BbPluginApi) {
  return {
    project_thread_create: async ({ request }: { request: NewThreadRequest }) => {
      const thread = await bb.sdk.threads.spawn(request);
      return { id: thread.id };
    },
  };
}
