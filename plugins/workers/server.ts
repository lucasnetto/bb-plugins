import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { PAGE_SIZE, WORKERS_CHANGED, rpcContract } from "./contract";

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async list({ threadId, offset }) {
      // BB filters archived and unarchived threads separately. Merge both before
      // paging so archiving a worker never removes it from this browser.
      async function readChildren(archived: boolean) {
        const rows = [];
        for (let pageOffset = 0; ; pageOffset += 100) {
          const page = await bb.sdk.threads.list({
            parentThreadId: threadId,
            includeHidden: true,
            archived,
            limit: 100,
            offset: pageOffset,
          });
          rows.push(...page);
          if (page.length < 100) return rows;
        }
      }
      const groups = await Promise.all([readChildren(false), readChildren(true)]);
      const rows = [...new Map(groups.flat().map((row) => [row.id, row])).values()].sort(
        (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
      );
      const workers = await Promise.all(
        rows.slice(offset, offset + PAGE_SIZE).map(async (row) => {
          // A worker may disappear between listing and reading its execution.
          const execution = await bb.sdk.threads
            .defaultExecutionOptions({ threadId: row.id })
            .catch(() => null);
          return {
            id: row.id,
            title: row.title ?? row.titleFallback ?? "Untitled worker",
            providerId: row.providerId,
            model: execution?.model ?? null,
            reasoningLevel: execution?.reasoningLevel ?? null,
            status: row.runtime.displayStatus,
            hasPendingInteraction: row.hasPendingInteraction,
            visibility: row.visibility,
            archived: row.archivedAt !== null,
          };
        }),
      );
      return { workers, hasMore: rows.length > offset + PAGE_SIZE };
    },
  });
  for (const event of [
    "thread.created",
    "thread.active",
    "thread.idle",
    "thread.failed",
    "thread.archived",
    "thread.deleted",
    "interaction.pending",
  ] as const) {
    bb.events.on(event, ({ thread }) => {
      if (thread.parentThreadId) {
        bb.realtime.publish(WORKERS_CHANGED, { threadId: thread.parentThreadId });
      }
    });
  }
}
