export const slots = ["180seg-orbisa-01", "180seg-orbisa-02", "180seg-orbisa-03"] as const;
export type Slot = (typeof slots)[number];
export function validateSlot(value: string): Slot {
  if (!slots.includes(value as Slot)) throw new Error("Unknown Orbisa slot");
  return value as Slot;
}

/** Coalesce simultaneous messages and retain failures until an explicit retry. */
export class WakeJobs {
  private jobs = new Map<string, Promise<void>>();
  private failures = new Set<string>();
  private run: (hostId: string, slot: Slot) => Promise<void>;
  constructor(run: (hostId: string, slot: Slot) => Promise<void>) {
    this.run = run;
  }
  running(hostId: string) {
    return this.jobs.has(hostId);
  }
  failed(hostId: string) {
    return this.failures.has(hostId);
  }
  start(hostId: string, slot: Slot, retry = false): Promise<void> {
    const existing = this.jobs.get(hostId);
    if (existing) return existing;
    if (retry) this.failures.delete(hostId);
    if (this.failures.has(hostId)) return Promise.resolve();
    const job = Promise.resolve()
      .then(() => this.run(hostId, slot))
      .catch(() => {
        this.failures.add(hostId);
      })
      .finally(() => this.jobs.delete(hostId));
    this.jobs.set(hostId, job);
    return job;
  }
  clear(hostId: string) {
    this.failures.delete(hostId);
  }
  async settle() {
    await Promise.allSettled(this.jobs.values());
  }
}
