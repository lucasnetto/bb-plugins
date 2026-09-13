import { setTimeout as delay } from "node:timers/promises";

export async function reconnectDaemon(options: {
  signal: AbortSignal;
  start: () => Promise<boolean>;
  connected: () => Promise<boolean>;
  timeoutMs?: number;
}) {
  const { signal, start, connected } = options;

  try {
    signal.throwIfAborted();

    if (!(await start())) return false;
    const until = performance.now() + (options.timeoutMs ?? 5_000);

    do {
      signal.throwIfAborted();

      if (await connected()) return true;

      if (performance.now() >= until) return false;
      await delay(200, undefined, { signal });
    } while (performance.now() < until);

    signal.throwIfAborted();

    return false;
  } catch {
    signal.throwIfAborted();

    return false;
  }
}
