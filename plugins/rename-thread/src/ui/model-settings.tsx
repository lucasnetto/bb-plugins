import { useEffect, useState } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { modelSelectionSchema, type ModelSelection, type rpcContract } from "../shared/contract";

export function ModelSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    rpc.call("getModelSelection", {}).then(
      (value) => {
        if (active) setSelection(value);
      },
      () => {
        if (active) setError("Could not load the title model.");
      },
    );

    return () => {
      active = false;
    };
  }, [rpc]);

  async function save(value: ModelSelection) {
    setSaving(true);
    setError("");

    try {
      setSelection(await rpc.call("setModelSelection", value));
    } catch {
      setError("Could not save the title model. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div className="mb-3 sm:mb-0">
        <p className="text-sm font-medium text-foreground">Title model</p>
        <p className="text-xs text-muted-foreground">
          Codex model used for isolated title generation.
        </p>
      </div>
      <div className="space-y-2 sm:text-right">
        {selection ? (
          <ProviderModelPicker
            value={selection}
            allowProviderChange={false}
            align="end"
            disabled={saving}
            onChange={(value) => {
              const parsed = modelSelectionSchema.safeParse(value);

              if (parsed.success) void save(parsed.data);
              else setError("That Codex model selection is unavailable.");
            }}
          />
        ) : (
          <span role="status" className="text-xs text-muted-foreground">
            Loading model…
          </span>
        )}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
