import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export interface MachineGroup {
  key: string;
  label: string;
  threads: PluginSidebarThread[];
}

/** Preserve incoming order; combine environments/projects by machine identity. */
export function groupByMachine(threads: readonly PluginSidebarThread[]): MachineGroup[] {
  const groups = new Map<string, MachineGroup>();

  for (const thread of threads) {
    const key = JSON.stringify(thread.host?.id ?? null);
    let group = groups.get(key);

    if (!group) {
      group = {
        key,
        label: thread.host?.name || thread.host?.id || "No machine",
        threads: [],
      };
      groups.set(key, group);
    }

    group.threads.push(thread);
  }

  return [...groups.values()];
}
