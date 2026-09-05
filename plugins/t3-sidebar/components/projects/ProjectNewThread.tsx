import { useEffect, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
  useRpc,
  type NewThreadComposerProps,
} from "@get-bb/plugin-sdk/app";
import type { projectSettingsContract, ProjectSettings } from "@/lib/project-settings";
import type { projectThreadContract } from "@/lib/project-thread-create";
import { Button } from "@/components/ui/button";

export function ProjectNewThread({ projectId }: { projectId: string }) {
  const rpc = useRpc<typeof projectSettingsContract & typeof projectThreadContract>();
  const navigate = useBbNavigate();
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setError(null);
    rpc.call("project_settings_get", { projectId }).then(
      (result) => { if (!cancelled) setSettings(result); },
      (cause) => { if (!cancelled) setError(String(cause)); },
    );
    return () => { cancelled = true; };
  }, [rpc, projectId, attempt]);

  if (!settings || settings.id !== projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        {error ? <>
          <p role="alert" className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
        </> : <p role="status" className="text-sm text-muted-foreground">Loading project…</p>}
      </div>
    );
  }

  const model = settings.model;
  const environment: NewThreadComposerProps["defaultEnvironment"] =
    settings.workspace === "default" ? undefined : {
      type: "host",
      ...(settings.hostId ? { hostId: settings.hostId } : {}),
      workspace: settings.workspace === "local"
        ? { type: "unmanaged", path: null }
        : { type: "managed-worktree", baseBranch: { kind: "default" } },
    };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && <p role="alert" className="px-6 pt-4 text-sm text-destructive">{error}</p>}
      <NewThreadComposer
        key={projectId}
        className="min-h-0 flex-1"
        draftKey={`t3-project-new:${projectId}`}
        defaultProjectId={projectId}
        defaultProviderId={model?.providerId}
        defaultModel={model?.model}
        defaultReasoningLevel={model?.reasoningLevel}
        defaultServiceTier={model?.serviceTier}
        defaultEnvironment={environment}
        onSubmit={async (request) => {
          setError(null);
          try {
            // The native composer owns subsequent edits, including project
            // switches. Preserve its visible choices and input provenance.
            const thread = await rpc.call("project_thread_create", { request });
            navigate.toThread(thread.id);
          } catch (cause) {
            setError(String(cause));
            throw cause;
          }
        }}
      />
    </div>
  );
}
