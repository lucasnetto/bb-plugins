import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const phaseSchema = z.enum([
  "process-start",
  "sdk-load",
  "credentials",
  "model-catalog",
  "checkpoint-load",
  "agent-create",
  "agent-resume",
  "agent-fork",
  "run-start",
  "cleanup",
]);

export type StartupPhase = z.infer<typeof phaseSchema>;

export const phaseEventSchema = z.object({
  phase: phaseSchema,
  state: z.enum(["started", "succeeded", "failed", "timed-out", "process-exited"]),
  durationMs: z.number().nonnegative().optional(),
});

export type PhaseEvent = z.infer<typeof phaseEventSchema>;

export const diagnosticSchema = phaseEventSchema.extend({ at: z.number(), pid: z.number() });

export const diagnosticsHostContract = defineRpcContract({
  diagnostics: {
    input: z.object({ threadId: z.string().min(1), runtimePackagePath: z.string().min(1) }),
    output: z.array(diagnosticSchema).max(80),
  },
});
