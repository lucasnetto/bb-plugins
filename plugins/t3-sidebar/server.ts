// bb-plugin-t3-sidebar — backend entry.
//
// The server bridges project management to BB's SDK and owns the one
// piece of state bb has no concept of: t3code-style "settled" threads. A
// settled thread is finished work the user parked out of the inbox; it
// collapses into the Settled shelf at the bottom of the list. The store is a
// map of threadId → settledAt (epoch ms) in bb.storage.kv, shared by every
// client of this bb through RPC + a realtime signal.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { AUTO_SETTLE_OPTIONS, SETTLED_CHANGED } from "./lib/contract";
import {
  projectSettingsContract,
  createProjectSettingsHandlers,
  registerProjectAutoPull,
} from "./lib/project-settings";
import { projectThreadContract, createProjectThreadHandlers } from "./lib/project-thread-create";

export type SettledMap = Record<string, number>;

export const rpcContract = defineRpcContract({
  ...projectSettingsContract,
  ...projectThreadContract,
  project_hosts: {
    input: z.null(),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  project_directory: {
    input: z.object({
      hostId: z.string().min(1),
      path: z.string().min(1).optional(),
    }),
    output: z.object({
      directory: z.string(),
      parent: z.string().nullable(),
      entries: z.array(z.object({ name: z.string(), path: z.string() })),
    }),
  },
  project_create: {
    input: z.object({ hostId: z.string().min(1), path: z.string().min(1) }),
    output: z.object({ id: z.string() }),
  },
  project_remove: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.null(),
  },
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
      : Object.fromEntries(Object.entries(current).filter(([id]) => !threadIds.includes(id)));
    return write(next);
  };

  bb.rpc.register(rpcContract, {
    ...createProjectSettingsHandlers(bb),
    ...createProjectThreadHandlers(bb),
    project_hosts: async () =>
      (await bb.sdk.hosts.list())
        .filter((host) => host.status === "connected")
        .map(({ id, name }) => ({ id, name })),
    project_directory: async (input) => {
      const listing = await bb.sdk.hosts.directory(input);
      return {
        directory: listing.directory,
        parent: listing.parent,
        entries: listing.entries
          .filter((entry) => entry.kind === "directory")
          .map(({ name, path }) => ({ name, path }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    project_create: async ({ hostId, path }) => {
      const name =
        path
          .replace(/[\\/]+$/u, "")
          .split(/[\\/]/u)
          .at(-1) || "Root";
      const project = await bb.sdk.projects.create({
        name,
        source: { type: "local_path", hostId, path },
      });
      return { id: project.id };
    },
    project_remove: async ({ projectId }) => {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      const project = projects.find((item) => item.id === projectId);
      if (!project || project.kind === "personal")
        throw new Error("This project cannot be removed");
      await bb.sdk.projects.delete({ projectId });
      return null;
    },
    settled_list: async () => ({ settled: await read() }),
    settled_set: async ({ threadIds, settled }) => ({
      settled: await setSettled(threadIds, settled),
    }),
  });

  registerProjectAutoPull(bb);

  bb.log.info("loaded");
}
