import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const orbisaRequest = z
  .object({
    action: z.enum(["version", "create", "inspect", "start", "stop", "remove", "exec"]),
    owner: z.string().min(1).max(1024),
    key: z.string().min(1).max(1024),
    id: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    backend: z.enum(["incus", "orbstack"]),
    image: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/)
      .default("orbisa-tooling-v2"),
    command: z.array(z.string()).max(1000).default([]),
    stdin: z
      .string()
      .max(16 * 1024 * 1024)
      .default(""),
    timeoutMs: z.number().int().min(100).max(1_700_000).default(600_000),
  })
  .strict();
export const orbisaHostContract = defineRpcContract({
  run: {
    input: orbisaRequest,
    output: z.object({ exitCode: z.number().int(), stdout: z.string(), stderr: z.string() }),
  },
});
