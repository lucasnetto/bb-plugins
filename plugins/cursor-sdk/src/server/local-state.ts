import type { LocalAgentStore } from "@cursor/sdk";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Schedule } from "effect";
import { z } from "zod";
import { SdkError, sdkError } from "./operations.js";

const ownerSchema = z.object({ pid: z.number().int().positive() });

function alive(pid: number) {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    // Permission errors and PID reuse must fail closed, never evict a live owner.
    return z.object({ code: z.string() }).safeParse(error).data?.code !== "ESRCH";
  }
}

/** SQLite arbitrates ownership across processes. A row survives a crash; only
 * a demonstrably dead owner can be replaced. No age-based lease expiry. */
export function acquireLocalLease(directory: string, resource: string): () => void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "coordination.sqlite");
  const db = new DatabaseSync(path);
  const token = randomUUID();

  try {
    db.exec("PRAGMA busy_timeout = 1000");
    db.exec(
      "CREATE TABLE IF NOT EXISTS owners (resource TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL)",
    );
    db.exec("BEGIN IMMEDIATE");
    const owner = db.prepare("SELECT pid FROM owners WHERE resource = ?").get(resource);

    if (owner && alive(ownerSchema.parse(owner).pid))
      throw new SdkError({
        code: "local_session_busy",
        message:
          "This Cursor conversation or store is still owned by a live process. Stop its thread before resuming.",
      });
    db.prepare("INSERT OR REPLACE INTO owners VALUES (?, ?, ?)").run(resource, process.pid, token);
    db.exec("COMMIT");
  } finally {
    db.close();
  }

  return () => {
    const connection = new DatabaseSync(path);

    try {
      connection.exec("PRAGMA busy_timeout = 1000");
      connection
        .prepare("DELETE FROM owners WHERE resource = ? AND token = ?")
        .run(resource, token);
    } finally {
      connection.close();
    }
  };
}

/** Cursor's JSONL store serializes only within one process. BB sessions run in
 * separate processes, so every read/modify/write must share this short lock. */
export function coordinatedLocalStore(store: LocalAgentStore, directory: string): LocalAgentStore {
  const locked = async <A>(operation: () => Promise<A>): Promise<A> => {
    const release = await Effect.runPromise(
      Effect.try({ try: () => acquireLocalLease(directory, "store"), catch: sdkError }).pipe(
        Effect.retry({
          while: (error) => error.code === "local_session_busy",
          schedule: Schedule.spaced("10 millis"),
          times: 2000,
        }),
      ),
    );

    try {
      return await operation();
    } finally {
      release();
    }
  };

  return {
    agents: {
      get: (input) => locked(() => store.agents.get(input)),
      list: (input) => locked(() => store.agents.list(input)),
      create: (input) => locked(() => store.agents.create(input)),
      update: (input) =>
        locked(async () => {
          const agent = input.agent;

          if (agent.activeRunId) {
            const run = await store.runs.get({ agentId: agent.agentId, runId: agent.activeRunId });

            if (run && run.status !== "running" && run.status !== "queued")
              return store.agents.update({
                agent: {
                  ...agent,
                  activeRunId: null,
                  status:
                    agent.status === "archived"
                      ? "archived"
                      : run.status === "error"
                        ? "error"
                        : "idle",
                },
              });
          }

          return store.agents.update(input);
        }),
      delete: (input) => locked(() => store.agents.delete(input)),
    },
    runs: {
      get: (input) => locked(() => store.runs.get(input)),
      list: (input) => locked(() => store.runs.list(input)),
      create: (input) => locked(() => store.runs.create(input)),
      update: (input) =>
        locked(async () => {
          const current = await store.runs.get({
            agentId: input.run.agentId,
            runId: input.run.runId,
          });

          // A checkpoint write already in flight when cancel() runs can carry
          // stale "running" state. Never resurrect a persisted terminal run.
          if (
            current &&
            current.status !== "running" &&
            current.status !== "queued" &&
            (input.run.status === "running" || input.run.status === "queued")
          )
            return current;

          return store.runs.update(input);
        }),
      delete: (input) => locked(() => store.runs.delete(input)),
    },
    checkpoints: {
      get: (input) => locked(() => store.checkpoints.get(input)),
      list: (input) => locked(() => store.checkpoints.list(input)),
      create: (input) => locked(() => store.checkpoints.create(input)),
      update: (input) => locked(() => store.checkpoints.update(input)),
      delete: (input) => locked(() => store.checkpoints.delete(input)),
    },
    runEvents: {
      append: (input) => locked(() => store.runEvents.append(input)),
      list: (input) => locked(() => store.runEvents.list(input)),
      delete: (input) => locked(() => store.runEvents.delete(input)),
    },
  };
}
