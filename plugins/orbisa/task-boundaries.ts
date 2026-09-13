import { z } from "zod";

// Node and fetch failures can carry a direct code or a nested transport cause.
export const errorCodeSchema = z.object({ code: z.string().nullish() });

export const connectionErrorSchema = z.object({
  code: z.string().nullish(),
  // An unrelated cause must not hide a valid top-level transport code.
  cause: errorCodeSchema.nullish().catch(undefined),
});

export const machineIdentitySchema = z.object({ id: z.string(), name: z.string() });

export const machineIsolationSchema = machineIdentitySchema.extend({
  config: z.object({
    isolated: z.boolean().optional(),
    isolate_network: z.boolean().optional(),
    forward_ssh_agent: z.boolean().optional(),
    // OrbStack owns mount details; isolation requires the array to be empty.
    mounts: z.array(z.unknown()).optional(),
  }),
});

export const machineSchema = machineIsolationSchema.extend({ state: z.string() });
