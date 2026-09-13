import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useComposer,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import {
  RUNTIME_CHANGED,
  runtimeSettingsSchema,
  type rpcContract,
} from "../shared/runtime-settings.js";
import "./app.css";

export function RuntimeDefault() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const { run } = useComposerView();
  const connection = useRealtimeConnectionState();
  const [cloud, setCloud] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const revision = useRef(0);
  const busy = useRef(false);

  useRealtime(RUNTIME_CHANGED, (payload) => {
    const parsed = runtimeSettingsSchema.safeParse(payload);

    if (!parsed.success) return;
    revision.current++;
    setCloud(parsed.data.cloudAgents);
    setError(null);
  });
  useEffect(() => {
    if (connection !== "connected") return;
    let mounted = true;
    const current = revision.current;
    void rpc
      .call("runtimeGet", {})
      .then((value) => {
        if (mounted && current === revision.current) {
          setCloud(value.cloudAgents);
          setError(null);
        }
      })
      .catch(() => {
        if (mounted) setError("Could not load Cursor default.");
      });

    return () => {
      mounted = false;
    };
  }, [connection, retry, rpc]);

  const toggle = async () => {
    if (cloud === null || busy.current || run.isSubmitting || connection !== "connected") return;
    busy.current = true;
    const current = ++revision.current;
    setSaving(true);
    setError(null);
    composer.setInputLock(true);

    try {
      const value = await rpc.call("runtimeSet", { cloudAgents: !cloud });

      if (current === revision.current) setCloud(value.cloudAgents);
    } catch {
      setError("Could not save Cursor default. Try again.");
    } finally {
      busy.current = false;
      setSaving(false);
      composer.setInputLock(false);
    }
  };

  return (
    <div className="cursor-runtime-default">
      <button
        type="button"
        role="switch"
        aria-checked={cloud === true}
        aria-busy={saving || cloud === null}
        aria-label="Use Cloud for new Cursor SDK threads"
        title="Shared default for new Cursor SDK conversations in this profile. Existing conversations keep their runtime. Other providers are unaffected."
        disabled={cloud === null || saving || run.isSubmitting || connection !== "connected"}
        onClick={() => void toggle()}
      >
        <span>cloud</span>
        <span className="cursor-runtime-track" aria-hidden="true">
          <span />
        </span>
      </button>
      {error && (
        <span role="alert">
          {error}{" "}
          {cloud === null && (
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              Retry
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function CompactRuntimeDefault() {
  return useComposerView().layout === "compact" ? <RuntimeDefault /> : null;
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "cursor-runtime-default",
    scopes: ["new-thread"],
    actions: [{ id: "runtime", component: RuntimeDefault }],
    banners: [{ id: "runtime-compact", chrome: "bare", component: CompactRuntimeDefault }],
  });
});
