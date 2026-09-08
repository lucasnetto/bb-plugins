import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { Machine, rpcContract } from "./contract.ts";

function WakeBanner() {
  const rpc = useRpc<typeof rpcContract>();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await rpc.call("list", null);
        if (!disposed) {
          setMachines(next);
          setError("");
        }
      } catch {
        if (!disposed) setError("Could not check Orbisa machines.");
      } finally {
        if (!disposed)
          timer = setTimeout(() => {
            void refresh();
          }, 2000);
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [rpc]);
  const offline = machines.filter(
    (machine) => machine.status !== "connected" && machine.status !== "unbound",
  );
  if (!offline.length && !error) return null;
  async function wake(slot: Machine["slot"]) {
    setPending(slot);
    setError("");
    try {
      await rpc.call("wake", { slot });
      setMachines((current) =>
        current.map((machine) =>
          machine.slot === slot ? { ...machine, status: "starting" } : machine,
        ),
      );
    } catch {
      setError("Could not start the VM. Please try again.");
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm">
      <p className="mb-2 text-muted-foreground">
        Wake an Orbisa VM to make it available in the Environment menu.
      </p>
      <div className="flex flex-wrap gap-2">
        {offline.map((machine) => (
          <button
            key={machine.slot}
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={machine.status === "starting" || pending === machine.slot}
            onClick={() => {
              void wake(machine.slot);
            }}
          >
            {machine.status === "starting"
              ? "Starting"
              : machine.status === "failed"
                ? "Retry"
                : "Wake"}{" "}
            {machine.slot}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
export default definePluginApp((app) => {
  app.composer.customize({
    id: "orbisa-wake",
    scopes: ["new-thread"],
    banners: [{ id: "wake", component: WakeBanner, chrome: "bare" }],
  });
});
