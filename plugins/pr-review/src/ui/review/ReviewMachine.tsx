import { useEffect, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { workspaceRpcContract } from "../../shared/workspace-contract";
import { Button } from "../components/ui/button";

export function ReviewMachine({
  threadId,
  url,
  active = true,
  children,
}: {
  threadId: string | null;
  url: string;
  active?: boolean;
  children: ReactNode;
}) {
  const rpc = useRpc<typeof workspaceRpcContract>();
  const [status, setStatus] = useState<"checking" | "waking" | "ready">("checking");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 5 * 60_000;
    setError("");

    const check = async (wake: boolean) => {
      try {
        const result = await rpc.call("prPrepare", { threadId, url, wake });

        if (disposed) return;
        setStatus(result.status);

        if (result.status === "waking") {
          if (Date.now() >= deadline) {
            setError(
              "The machine is taking longer than expected. Check its status in Machines, then retry.",
            );
          } else {
            timer = setTimeout(() => void check(false), 1000);
          }
        }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };

    void check(true);

    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [rpc, threadId, url, active, retry]);

  if (!error && status === "ready") return children;

  return (
    <section
      className="flex h-full flex-col items-start justify-center gap-3 p-6"
      aria-label="Pull request machine"
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p role="status">{status === "waking" ? "Waking machine…" : "Connecting to machine…"}</p>
      )}
      {error && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setStatus("checking");
            setError("");
            setRetry((value) => value + 1);
          }}
        >
          Retry
        </Button>
      )}
    </section>
  );
}
