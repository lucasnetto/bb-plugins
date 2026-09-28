import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  diagnosticSchema,
  type DiagnosticEvent,
  type StartupPhase,
} from "../shared/diagnostics.js";

export const phaseDeadlines: Record<StartupPhase, number> = {
  "process-start": 30_000,
  "sdk-load": 30_000,
  credentials: 30_000,
  "model-catalog": 20_000,
  "checkpoint-load": 120_000,
  "agent-create": 90_000,
  "agent-resume": 90_000,
  "agent-fork": 120_000,
  "run-start": 120_000,
  cleanup: 15_000,
};

const pathFor = (dataDir: string, threadId: string) =>
  join(dataDir, "diagnostics", `${createHash("sha256").update(threadId).digest("hex")}.json`);

export function readDiagnostics(dataDir: string, threadId: string) {
  try {
    return z
      .array(diagnosticSchema)
      .max(80)
      .parse(JSON.parse(readFileSync(pathFor(dataDir, threadId), "utf8")));
  } catch (error) {
    if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success) return [];

    throw error;
  }
}

/** The router is the single writer. Never persist prompts, tool data, env, or SDK errors. */
export function recordDiagnostic(dataDir: string, threadId: string, event: DiagnosticEvent) {
  const destination = pathFor(dataDir, threadId);
  const temporary = `${destination}.${randomUUID()}.tmp`;

  try {
    let previous: ReturnType<typeof readDiagnostics> = [];

    try {
      previous = readDiagnostics(dataDir, threadId);
    } catch {
      /* Replace a damaged diagnostic log. */
    }

    mkdirSync(join(dataDir, "diagnostics"), { recursive: true, mode: 0o700 });
    writeFileSync(
      temporary,
      JSON.stringify([...previous.slice(-79), { ...event, at: Date.now(), pid: process.pid }]),
      { mode: 0o600 },
    );
    renameSync(temporary, destination);
  } catch {
    // Diagnostics must never stop a conversation on a full/read-only disk.
  } finally {
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* Best effort. */
    }
  }
}
