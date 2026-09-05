// bb-plugin-t3-sidebar — backend entry.
//
// The sidebar itself is pure frontend (app.tsx). The server owns the one
// piece of state bb has no concept of: t3code-style "settled" threads. A
// settled thread is finished work the user parked out of the inbox; it
// collapses into the Settled shelf at the bottom of the list. The store is a
// map of threadId → settledAt (epoch ms) in bb.storage.kv, shared by every
// client of this bb through RPC + a realtime signal.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { AUTO_SETTLE_OPTIONS, SETTLED_CHANGED } from "./lib/contract";

export type SettledMap = Record<string, number>;

export const rpcContract = defineRpcContract({
  settled_list: {
    input: z.null(),
    output: z.object({ settled: z.record(z.string(), z.number()) }),
  },
  settled_set: {
    input: z.object({
      threadIds: z.array(z.string().min(1)).min(1).max(500),
      settled: z.boolean(),
    }),
    output: z.object({ settled: z.record(z.string(), z.number()) }),
  },
});

const SETTLED_KEY = "settled";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    autoSettleAfter: {
      type: "select",
      label: "Auto-settle idle threads after",
      description:
        "Read, idle threads with no new attention for this long collapse into the Settled shelf on their own. Pinned threads never auto-settle.",
      options: [...AUTO_SETTLE_OPTIONS],
      default: "1 day",
    },
  });

  const read = async (): Promise<SettledMap> =>
    (await bb.storage.kv.get<SettledMap>(SETTLED_KEY)) ?? {};

  const write = async (next: SettledMap): Promise<SettledMap> => {
    await bb.storage.kv.set(SETTLED_KEY, next);
    bb.realtime.publish(SETTLED_CHANGED, { count: Object.keys(next).length });
    return next;
  };

  const setSettled = async (
    threadIds: readonly string[],
    settled: boolean,
  ): Promise<SettledMap> => {
    const current = await read();
    const now = Date.now();
    const next: SettledMap = settled
      ? { ...current, ...Object.fromEntries(threadIds.map((id) => [id, now])) }
      : Object.fromEntries(
          Object.entries(current).filter(([id]) => !threadIds.includes(id)),
        );
    return write(next);
  };

  bb.rpc.register(rpcContract, {
    settled_list: async () => ({ settled: await read() }),
    settled_set: async ({ threadIds, settled }) => ({
      settled: await setSettled(threadIds, settled),
    }),
  });

  bb.log.info("loaded");
}
