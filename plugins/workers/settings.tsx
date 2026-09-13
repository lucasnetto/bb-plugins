import { useEffect, useState } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_useProviders as useProviders,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import { configurationSchema, type WorkerPreset } from "./presets";

const control =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const button =
  "rounded-md border border-border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed";

export function WorkerSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const providers = useProviders();

  const [configuration, setConfiguration] = useState<{
    revision: number;
    presets: WorkerPreset[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    rpc.call("getConfiguration", {}).then(
      (result) => {
        if (disposed) return;
        setConfiguration(result);
        setError("");
        setLoading(false);
      },
      (cause: unknown) => {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : "Could not load presets.");
        setLoading(false);
      },
    );

    return () => {
      disposed = true;
    };
  }, [rpc, reload]);

  function change(presets: WorkerPreset[]) {
    setConfiguration((current) => (current ? { ...current, presets } : current));
    setSaved(false);
  }

  async function save() {
    const parsed = configurationSchema.safeParse(configuration);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the preset fields.");

      return;
    }

    setSaving(true);
    setError("");
    setSaved(false);

    try {
      setConfiguration(await rpc.call("saveConfiguration", parsed.data));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save presets.");
    } finally {
      setSaving(false);
    }
  }

  const firstProvider = providers.providers.find((provider) => provider.available);

  return (
    <section className="space-y-4 text-foreground" aria-label="Worker presets">
      <p className="text-sm text-muted-foreground">
        Workers inherit their parent's provider, model, and thinking level by default. Optional
        presets belong only to this BB profile. Agents see each name and description, not the model
        settings.
      </p>
      {loading ? <p role="status">Loading presets…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {configuration && !loading ? (
        <fieldset disabled={saving} className="space-y-4">
          {!configuration.presets.length ? (
            <p className="text-sm">No presets configured. Workers use inheritance only.</p>
          ) : null}
          {configuration.presets.map((preset, index) => (
            <fieldset key={index} className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-medium">Preset {index + 1}</legend>
              <label className="block space-y-1 text-sm">
                <span>Name</span>
                <input
                  className={control}
                  value={preset.name}
                  maxLength={64}
                  placeholder="quick-task"
                  onChange={(event) =>
                    change(
                      configuration.presets.map((row, i) =>
                        i === index ? { ...row, name: event.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Description — when should an agent use this?</span>
                <textarea
                  className={control}
                  value={preset.description}
                  maxLength={300}
                  rows={2}
                  placeholder="Small, well-defined changes and simple lookups."
                  onChange={(event) =>
                    change(
                      configuration.presets.map((row, i) =>
                        i === index ? { ...row, description: event.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
              <div className="space-y-1 text-sm">
                <p>Provider, model, and thinking level</p>
                <ProviderModelPicker
                  value={preset}
                  disabled={saving}
                  onChange={({ providerId, model, reasoningLevel }) =>
                    change(
                      configuration.presets.map((row, i) =>
                        i === index ? { ...row, providerId, model, reasoningLevel } : row,
                      ),
                    )
                  }
                />
              </div>
              <button
                type="button"
                className={button}
                onClick={() => change(configuration.presets.filter((_, i) => i !== index))}
              >
                Remove preset {index + 1}
              </button>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={!firstProvider || configuration.presets.length >= 20}
              onClick={() =>
                change([
                  ...configuration.presets,
                  {
                    name: "",
                    description: "",
                    providerId: firstProvider!.id,
                    model: "",
                    reasoningLevel: "none",
                  },
                ])
              }
            >
              Add preset
            </button>
            <button type="button" className={button} onClick={() => void save()}>
              {saving ? "Saving…" : "Save presets"}
            </button>
          </div>
          {providers.status === "error" ? <p role="alert">Could not load providers.</p> : null}
        </fieldset>
      ) : null}
      <button
        type="button"
        className={button}
        disabled={saving || loading}
        onClick={() => {
          setSaved(false);
          setReload((value) => value + 1);
        }}
      >
        Reload saved presets
      </button>
      {saved ? (
        <p role="status" className="text-sm">
          Presets saved.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Names use lowercase letters, numbers, and hyphens. Changes apply when an agent session next
        starts or resumes; running sessions keep their current tool schema. Unavailable presets fail
        explicitly rather than switching models.
      </p>
    </section>
  );
}
