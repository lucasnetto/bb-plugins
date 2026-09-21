import type { LocalAgentStore, SDKAgent } from "@cursor/sdk";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { foreign, SdkError } from "./operations.js";

// Copy opaque, content-addressed blobs through the public store API. Run IDs
// and event logs belong to the source; the child starts its own run history.
export const forkLocalAgent = Effect.fn("CursorSdk.forkLocalAgent")(function* (
  store: LocalAgentStore,
  sourceId: string,
  cwd: string,
  resume: (agentId: string) => Promise<SDKAgent>,
  target: LocalAgentStore = store,
) {
  const source = yield* foreign(() => store.agents.get({ agentId: sourceId }));

  if (!source?.latestCheckpoint)
    return yield* Effect.fail(
      new SdkError({
        message: "The source conversation has no saved checkpoint on this host/profile.",
      }),
    );

  if (source.status === "running" || source.activeRunId)
    return yield* Effect.fail(
      new SdkError({ message: "Wait for the source thread to finish before forking." }),
    );

  const checkpoint = source.latestCheckpoint;
  const agentId = `agent-${randomUUID()}`;

  return yield* Effect.gen(function* () {
    let cursor: string | undefined;

    do {
      const page = yield* foreign(() =>
        store.checkpoints.list({ filter: { agentIds: [sourceId], cursor, limit: 100 } }),
      );

      for (const blobId of page.items) {
        const data = yield* foreign(() => store.checkpoints.get({ agentId: sourceId, blobId }));

        if (!data)
          return yield* Effect.fail(
            new SdkError({ message: "The source checkpoint is incomplete. Cannot fork it." }),
          );
        yield* foreign(() => target.checkpoints.create({ agentId, blobId, data }));
      }

      cursor = page.nextCursor;
    } while (cursor);

    const root = yield* foreign(() =>
      target.checkpoints.get({ agentId, blobId: checkpoint.rootBlobId }),
    );

    if (!root)
      return yield* Effect.fail(
        new SdkError({ message: "The source checkpoint is missing. Cannot fork it." }),
      );
    const current = yield* foreign(() => store.agents.get({ agentId: sourceId }));

    if (
      !current ||
      current.status === "running" ||
      current.activeRunId ||
      current.updatedAt !== source.updatedAt ||
      current.latestCheckpoint?.rootBlobId !== checkpoint.rootBlobId
    )
      return yield* Effect.fail(
        new SdkError({
          message: "The source conversation changed while forking. Try again after it finishes.",
        }),
      );

    const now = Date.now();
    yield* foreign(() =>
      target.agents.create({
        agent: {
          ...source,
          agentId,
          cwd,
          status: "idle",
          activeRunId: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    return yield* foreign(() => resume(agentId));
  }).pipe(
    Effect.onError(() =>
      foreign(async () => {
        await target.checkpoints.delete({ filter: { agentIds: [agentId] } });

        if (await target.agents.get({ agentId }))
          await target.agents.delete({ filter: { agentIds: [agentId] } });
      }).pipe(Effect.orDie),
    ),
  );
});
