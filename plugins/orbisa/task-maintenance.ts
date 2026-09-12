import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { dirname, join } from "node:path";
import { prunePreparedBases, type BaseReceipts, type CachedBase } from "./task-base-retention.ts";
import { serializeBase } from "./task-base.ts";
import { pruneGitCaches } from "./task-git-cache.ts";
import { checked } from "./task-process.ts";

export function registerTaskMaintenance(bb: BbPluginApi, owner: string, receipts: BaseReceipts) {
  const controller = new AbortController();
  const signal = controller.signal;
  let pending: Promise<void> | undefined;
  function sweep() {
    if (signal.aborted) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      await pruneGitCaches(join(dirname(bb.storage.database().name), "git-cache"), signal);
      await serializeBase(async () => {
        signal.throwIfAborted();
        const current = await bb.storage.kv.get<string>("task-base-current");
        if (
          typeof current !== "string" ||
          !new RegExp(`^orbisa-base-${owner}-[a-f0-9]{16}$`).test(current)
        )
          return;
        await prunePreparedBases({
          owner,
          current,
          receipts,
          list: async () =>
            JSON.parse(
              await checked(["orbctl", "list", "--format", "json"], { signal }),
            ) as CachedBase[],
          remove: async (vm) => {
            await checked(["orbctl", "delete", "-f", vm.name], { signal });
          },
        });
      });
    })()
      .catch(() => {
        if (!signal.aborted)
          bb.log.warn("Orbisa cache maintenance deferred; will retry in the background.");
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  bb.background.schedule("task-cache-maintenance", "17 * * * *", sweep);
  bb.background.service("task-cache-maintenance-startup", {
    async start() {
      await sweep();
    },
  });
  bb.onDispose(async () => {
    controller.abort();
    await pending;
  });
}
