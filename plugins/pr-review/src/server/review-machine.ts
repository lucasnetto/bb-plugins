import type { BbPluginApi } from "@get-bb/plugin-sdk";

interface WakeOperation {
  pending: boolean;
  error: string | null;
}

// These are ongoing core-owned lifecycle operations, not cached host readiness.
// Every request checks the current host; only an explicit panel open may resume it.
export function createReviewMachine(bb: BbPluginApi) {
  const wakes = new Map<string, WakeOperation>();
  bb.onDispose(() => wakes.clear());

  return async (hostId: string, wake: boolean): Promise<{ status: "ready" | "waking" }> => {
    const host = await bb.sdk.hosts.get({ hostId });
    const phase = host.lifecycle.phase;

    if (phase === "active" && host.status === "connected") {
      wakes.delete(hostId);

      return { status: "ready" };
    }

    if (phase === "removing" || phase === "destroyed") {
      throw new Error(
        `Machine “${host.name}” is ${phase}. Open this PR from an available machine.`,
      );
    }

    if (phase === "active") {
      throw new Error(`Machine “${host.name}” is offline. Reconnect it in Machines, then retry.`);
    }

    let operation = wakes.get(hostId);

    if (wake && !operation?.pending && (phase === "suspended" || phase === "suspending")) {
      const started: WakeOperation = { pending: true, error: null };
      operation = started;
      wakes.set(hostId, started);
      // Resume can take minutes. Keep the RPC short and let the panel poll.
      // Core owns this operation and shares it with other machine consumers.
      void bb.sdk.hosts.experimental_resume({ hostId }).then(
        () => {
          started.pending = false;
        },
        (error) => {
          started.pending = false;
          started.error = error instanceof Error ? error.message : String(error);
        },
      );
    }

    if (operation?.error) {
      throw new Error(
        `Could not wake machine “${host.name}”: ${operation.error}. Retry to try again.`,
      );
    }

    if (phase === "suspended" && !operation?.pending) {
      throw new Error(`Machine “${host.name}” is suspended. Retry to wake it.`);
    }

    return { status: "waking" };
  };
}
