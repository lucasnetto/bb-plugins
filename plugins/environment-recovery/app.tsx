import { useEffect, useId, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
  useSdk,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, RecoveryPreview, RecoveryResult } from "./contract";

const button =
  "rounded border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50";

export function RecoveryPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const listId = useId();
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecoveryResult | null>(null);

  useEffect(() => {
    let current = true;
    setPreview(null);
    setBranch("");
    setError(null);
    setResult(null);
    rpc
      .call("preview", { threadId })
      .then((value) => {
        if (current) {
          setPreview(value);
          setBranch(value.branch ?? "");
        }
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      });

    return () => {
      current = false;
    };
  }, [rpc, threadId]);

  async function recover() {
    setBusy(true);
    setError(null);

    try {
      const value = await rpc.call("recover", { threadId, branch: branch.trim() });
      setResult(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recovery failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <h2 className="text-base font-medium">Recover workspace</h2>
      <p className="text-muted-foreground">
        Create a new worktree from a surviving branch and a continuation thread with the original
        request and recent messages.
      </p>
      <p className="text-muted-foreground">
        Only committed files are restored. The original thread remains available as the full
        conversation history.
      </p>
      {!preview && !error && <p role="status">Checking recovery source…</p>}
      {preview && (
        <>
          <label className="block space-y-2">
            <span>Branch</span>
            <input
              className="w-full rounded border border-border bg-background px-3 py-2"
              list={listId}
              value={branch}
              disabled={busy || !!result}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="Branch name"
            />
            <datalist id={listId}>
              {preview.branches.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          {preview.reason && <p className="text-muted-foreground">{preview.reason}</p>}
          {!result && (
            <button
              className={button}
              disabled={busy || !branch.trim() || (!preview.available && !preview.branches.length)}
              onClick={() => void recover()}
            >
              {busy ? "Creating workspace…" : "Create recovery"}
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-3">
          <p role="status">
            {result.reused
              ? "A recovery already exists."
              : "Recovery created. BB will prepare the new workspace."}
          </p>
          <button className={button} onClick={() => navigate.toThread(result.threadId)}>
            Open recovered thread
          </button>
        </div>
      )}
    </div>
  );
}

function RecoveryAction({ threadId }: PluginThreadHeaderActionProps) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let current = true;

    async function refresh() {
      try {
        const thread = await sdk.threads.get({ threadId });

        const environment = thread.environmentId
          ? await sdk.environments.get({ environmentId: thread.environmentId })
          : null;

        if (current) setAvailable(environment?.status === "destroyed");
      } catch {
        if (current) setAvailable(false);
      }
    }

    setAvailable(false);
    void refresh();

    const unsubscribe = sdk.subscribe({
      event: "environment:changed",
      callback: () => void refresh(),
    });

    return () => {
      current = false;
      unsubscribe();
    };
  }, [sdk, threadId]);

  if (!available) return null;

  return (
    <button
      className="h-7 rounded border border-border px-2 text-xs hover:bg-accent"
      onClick={() => navigate.openThreadPanel({ actionId: "recover" })}
    >
      Recover workspace
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "recover",
    title: "Recover workspace",
    component: RecoveryPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "recover",
    title: "Recover workspace",
    component: RecoveryAction,
  });
});
