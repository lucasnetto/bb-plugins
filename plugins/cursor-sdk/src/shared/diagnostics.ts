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

const processExitEventSchema = z.object({
  phase: z.literal("session-process"),
  state: z.literal("process-exited"),
  durationMs: z.number().nonnegative(),
  childPid: z.number().optional(),
  exitCode: z.number().nullable().optional(),
  signal: z.string().nullable().optional(),
  reason: z.enum([
    "unexpected-exit",
    "idle",
    "release",
    "stop",
    "failed-turn",
    "shutdown",
    "startup-failed",
    "timeout",
  ]),
});

export type ProcessExitEvent = z.infer<typeof processExitEventSchema>;

export type DiagnosticEvent = PhaseEvent | ProcessExitEvent;

export const diagnosticSchema = z.union([
  phaseEventSchema.extend({ at: z.number(), pid: z.number() }),
  processExitEventSchema.extend({ at: z.number(), pid: z.number() }),
]);

export const diagnosticsHostContract = defineRpcContract({
  diagnostics: {
    input: z.object({ threadId: z.string().min(1), runtimePackagePath: z.string().min(1) }),
    output: z.array(diagnosticSchema).max(80),
  },
});
