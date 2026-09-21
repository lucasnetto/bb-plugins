import type { LocalAgentStore } from "@cursor/sdk";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { acquireLocalLease, coordinatedLocalStore } from "./local-state.js";
import { SdkError } from "./operations.js";

const locationSchema = z.object({ version: z.literal(1), directory: z.string().uuid() });

/** The caller holds the profile-wide agent lease, including while migrating.
 * Old plugin processes use that same lease. Each new store has its own I/O lock. */
export function conversationStores(root: string, makeStore: (path: string) => LocalAgentStore) {
  const index = (agentId: string) =>
    join(root, "locations", `${createHash("sha256").update(agentId).digest("hex")}.json`);

  const allocate = () => {
    const directory = randomUUID();
    const path = join(root, "sessions", directory);
    const store = coordinatedLocalStore(makeStore(path), path);

    return {
      store,
      path,
      async publish(agentId: string) {
        await mkdir(join(root, "locations"), { recursive: true, mode: 0o700 });
        const destination = index(agentId);
        const temporary = `${destination}.${randomUUID()}.tmp`;

        try {
          await writeFile(temporary, JSON.stringify({ version: 1, directory }), { mode: 0o600 });
          await rename(temporary, destination);
        } finally {
          await rm(temporary, { force: true });
        }
      },
    };
  };

  const open = async (agentId: string, migrateLegacy = true): Promise<LocalAgentStore> => {
    let saved: string;

    try {
      saved = await readFile(index(agentId), "utf8");
    } catch (error) {
      if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success) {
        return migrateLegacy ? migrate(agentId) : coordinatedLocalStore(makeStore(root), root);
      }

      throw error;
    }

    // An invalid index must never fall back to an older, stale conversation.
    const { directory } = locationSchema.parse(JSON.parse(saved));
    const path = join(root, "sessions", directory);
    const store = coordinatedLocalStore(makeStore(path), path);

    if (!(await store.agents.get({ agentId })))
      throw new SdkError({
        code: "checkpoint_missing",
        message: "The isolated Cursor store is missing. Use bb cursor-sdk recover <thread-id>.",
      });

    return store;
  };

  const migrate = async (agentId: string): Promise<LocalAgentStore> => {
    const release = acquireLocalLease(root, `migration:${agentId}`);

    try {
      return await migrateUnlocked(agentId);
    } finally {
      release();
    }
  };

  const migrateUnlocked = async (agentId: string): Promise<LocalAgentStore> => {
    const legacy = coordinatedLocalStore(makeStore(root), root);
    const agent = await legacy.agents.get({ agentId });

    if (!agent)
      throw new SdkError({
        code: "checkpoint_missing",
        message:
          "The Cursor checkpoint is missing on this host/profile. Use bb cursor-sdk recover <thread-id>.",
      });

    const target = allocate();

    try {
      let cursor: string | undefined;

      do {
        const page = await legacy.checkpoints.list({
          filter: { agentIds: [agentId], cursor, limit: 100 },
        });

        for (const blobId of page.items) {
          const data = await legacy.checkpoints.get({ agentId, blobId });

          if (!data) throw new Error("The legacy Cursor checkpoint is incomplete.");
          await target.store.checkpoints.create({ agentId, blobId, data });
        }

        cursor = page.nextCursor;
      } while (cursor);

      if (
        agent.latestCheckpoint &&
        !(await target.store.checkpoints.get({
          agentId,
          blobId: agent.latestCheckpoint.rootBlobId,
        }))
      )
        throw new Error("The legacy Cursor checkpoint root is missing.");

      do {
        const page = await legacy.runs.list({
          filter: { agentIds: [agentId], cursor, limit: 100 },
        });

        for (const run of page.items) {
          await target.store.runs.create({ run });
          let afterOffset: string | undefined;

          do {
            const events = await legacy.runEvents.list({
              runId: run.runId,
              afterOffset,
              limit: 100,
            });

            for (const event of events.items)
              await target.store.runEvents.append({
                runId: run.runId,
                eventType: event.eventType,
                payload: event.payload,
                payloadRef: event.payloadRef,
                idempotencyKey: event.idempotencyKey,
              });
            afterOffset = events.nextOffset;
          } while (afterOffset);
        }

        cursor = page.nextCursor;
      } while (cursor);

      await target.store.agents.create({ agent });
      // Publication is the commit point. The untouched legacy copy remains a backup.
      await target.publish(agentId);

      return target.store;
    } catch (error) {
      await rm(target.path, { recursive: true, force: true });

      throw error;
    }
  };

  return { allocate, open };
}
