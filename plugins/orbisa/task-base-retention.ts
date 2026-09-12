export interface BaseReceipts {
  get(name: string): Promise<unknown>;
  set(name: string, vmId: string): Promise<unknown>;
  lastUsed?(name: string): Promise<unknown>;
  touch?(name: string, at: number): Promise<unknown>;
}
export interface CachedBase {
  name: string;
  id: string;
  state: string;
  config: {
    isolated?: boolean;
    isolate_network?: boolean;
    forward_ssh_agent?: boolean;
    mounts?: unknown[];
  };
}
const WEEK = 7 * 24 * 60 * 60_000;
const safe = (vm: CachedBase) =>
  vm.state === "stopped" &&
  vm.config.isolated === true &&
  vm.config.isolate_network === true &&
  vm.config.forward_ssh_agent === false &&
  !vm.config.mounts?.length;

// Caller holds the same lock used for building and cloning bases.
export async function prunePreparedBases(options: {
  owner: string;
  current: string;
  receipts: BaseReceipts;
  list: () => Promise<CachedBase[]>;
  remove: (vm: CachedBase) => Promise<void>;
  now?: number;
}) {
  const { owner, current, receipts, list, remove } = options;
  if (!receipts.touch || !receipts.lastUsed || !/^[a-f0-9]{10}$/.test(owner)) return;
  const now = options.now ?? Date.now();
  await receipts.touch(current, now);
  const candidates: { vm: CachedBase; used: number }[] = [];
  for (const vm of await list()) {
    if (
      !new RegExp(`^orbisa-base-${owner}-[a-f0-9]{16}$`).test(vm.name) ||
      !safe(vm) ||
      (await receipts.get(vm.name)) !== vm.id
    )
      continue;
    const value = await receipts.lastUsed(vm.name);
    const used = typeof value === "number" && Number.isFinite(value) ? value : now;
    // Existing caches receive a full grace period after upgrading.
    if (used === now) await receipts.touch(vm.name, now);
    candidates.push({ vm, used });
  }
  const fallback = candidates
    .filter(({ vm }) => vm.name !== current)
    .sort((a, b) => b.used - a.used)[0]?.vm.name;
  for (const { vm, used } of candidates) {
    if (vm.name === current || vm.name === fallback || now - used < WEEK) continue;
    const fresh = (await list()).find((item) => item.name === vm.name);
    if (fresh?.id === vm.id && safe(fresh)) await remove(fresh);
  }
}
