import { setTimeout as delay } from "node:timers/promises";

export type StartupCategory =
  | "host-unavailable"
  | "unsupported-workspace"
  | "authentication-failed"
  | "incompatible-runtime"
  | "startup-failed";
export class StartupFailure extends Error {
  readonly category: StartupCategory;
  constructor(category: StartupCategory, action: string) {
    super(`[${category}] ${action}`);
    this.name = "StartupFailure";
    this.category = category;
  }
}

export async function startupStep<T>(
  category: StartupCategory,
  action: string,
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof StartupFailure) throw error;
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
      throw new StartupFailure(
        "incompatible-runtime",
        "A required executable is missing. Restore the supported tools on the execution host and retry.",
      );
    // Never copy subprocess output or credential-bearing arguments into errors.
    throw new StartupFailure(category, action);
  }
}

export function transientConnection(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string } } | null;
  const code = value?.code ?? value?.cause?.code;
  return (
    code !== undefined &&
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EPIPE",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(code)
  );
}

/** Only use for idempotent connection probes/enrollment, never a whole provision. */
export async function retryConnection<T>(
  work: () => Promise<T>,
  signal: AbortSignal,
  report: (text: string) => void,
  pause = (ms: number) => delay(ms, undefined, { signal }),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await work();
    } catch (error) {
      signal.throwIfAborted();
      if (attempt >= 2 || !transientConnection(error)) throw error;
      report(`Transient host connection failure; retry ${attempt + 1}/2.`);
      await pause(500 * (attempt + 1));
    }
  }
}
