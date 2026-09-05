import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { projectSettingsContract } from "./project-settings-contract";
import { projectThreadContract } from "./project-thread-contract";
export type SettledMap = Record<string, number>;

export const rpcContract = defineRpcContract({
  ...projectSettingsContract,
  ...projectThreadContract,
  project_hosts: {
    input: z.null(),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  project_directory: {
    input: z.object({
      hostId: z.string().min(1),
      path: z.string().min(1).optional(),
    }),
    output: z.object({
      directory: z.string(),
      parent: z.string().nullable(),
      entries: z.array(z.object({ name: z.string(), path: z.string() })),
    }),
  },
  project_create: {
    input: z.object({ hostId: z.string().min(1), path: z.string().min(1) }),
    output: z.object({ id: z.string() }),
  },
  project_remove: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.null(),
  },
  settled_list: {
    input: z.null(),
    output: z.object({ settled: z.record(z.string(), z.number()) }),
  },
  settled_set: {
    input: z.object({
      threadIds: z.array(z.string().min(1)).min(1).max(500),
      settled: z.boolean(),
    }),
    output: z.object({ settled: z.record(z.string(), z.number()) }),
  },
});
