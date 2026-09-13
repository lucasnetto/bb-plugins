import { useEffect, useState } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import type { GuideModel } from "../../shared/guide-generation";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";

export function GuideGenerator({
  threadId,
  open,
  onOpenChange,
  pending,
  onStart,
}: {
  threadId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  pending: boolean;
  onStart: (model: GuideModel) => Promise<void>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [model, setModel] = useState<GuideModel | null>(null);
  const [environmentId, setEnvironmentId] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setModel(null);
    setError("");
    void rpc.call("guideOptions", { threadId }).then(
      (options) => {
        if (disposed) return;
        setModel(options.model);

        if (!options.model)
          setError("No model is available. Configure a guide model in PR Review settings.");
        setEnvironmentId(options.environmentId);
        setSource(options.source);
      },
      (error) => {
        if (!disposed) setError(String(error));
      },
    );

    return () => {
      disposed = true;
    };
  }, [rpc, threadId, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate review guide</DialogTitle>
          <DialogDescription>
            Choose a model to organize this PR into chapters. The guide appears here when ready.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {model ? (
          <>
            <ProviderModelPicker
              value={model}
              onChange={setModel}
              routing={{ kind: "environment", environmentId }}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              Starts with your {source} default. Changes here apply only to this generation.
            </p>
          </>
        ) : !error ? (
          <p className="text-sm text-muted-foreground">Loading model…</p>
        ) : null}
        <Button disabled={!model || pending} onClick={() => model && void onStart(model)}>
          {pending ? "Starting…" : "Generate guide"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function GuideModelSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<readonly { id: string; name: string }[]>([]);
  const [model, setModel] = useState<GuideModel | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let disposed = false;
    setModel(null);
    setNotice("");
    void rpc.call("guideSettings", { projectId }).then(
      (value) => {
        if (disposed) return;
        setProjects(value.projects);
        setModel(value.model ?? value.fallback);
        setNotice(value.model ? "Saved default" : "Using inherited default");
      },
      (error) => {
        if (!disposed) setNotice(String(error));
      },
    );

    return () => {
      disposed = true;
    };
  }, [rpc, projectId]);

  async function save(value: GuideModel | null) {
    setPending(true);

    try {
      await rpc.call("guideDefaultsSave", { projectId, model: value });

      if (!value) {
        const updated = await rpc.call("guideSettings", { projectId });
        setModel(updated.model ?? updated.fallback);
      }

      setNotice(value ? "Default saved" : "Override removed");
    } catch (error) {
      setNotice(String(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Project defaults override the plugin default. Each generation still lets you choose another
        model.
      </p>
      <select
        disabled={pending}
        aria-label="Guide model scope"
        className="w-full rounded-md border bg-background p-2 text-sm"
        value={projectId ?? ""}
        onChange={(e) => setProjectId(e.target.value || null)}
      >
        <option value="">Plugin default · all projects</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {model ? <ProviderModelPicker value={model} onChange={setModel} disabled={pending} /> : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={!model || pending} onClick={() => void save(model)}>
          Save default
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => void save(null)}>
          Use inherited default
        </Button>
      </div>
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
