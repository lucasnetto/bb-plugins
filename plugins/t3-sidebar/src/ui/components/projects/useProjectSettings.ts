import { useEffect, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "@/shared/rpc-contract";
import type { ProjectSettings } from "@/shared/project-settings-contract";

export function useProjectSettings(projectId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    rpc.call("project_settings_get", { projectId }).then(
      (result) => {
        if (cancelled) return;
        setSettings(result);
        setName(result.name);
      },
      (cause) => {
        if (!cancelled) setError(String(cause));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [projectId, revision, rpc]);

  async function save(
    patch: Partial<Pick<ProjectSettings, "name" | "model" | "workspace" | "autoPull">>,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setSaved(false);
    setError(null);

    try {
      const result = await rpc.call("project_settings_update", {
        projectId,
        ...patch,
      });

      setSettings(result);

      if (patch.name !== undefined) setName(result.name);
      setSaved(true);
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function remove() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);

    try {
      await rpc.call("project_remove", { projectId });
      navigate.toPluginPanel("projects");
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return {
    settings,
    name,
    setName,
    error,
    setError,
    pending,
    saved,
    setSaved,
    retry: () => setRevision((value) => value + 1),
    save,
    remove,
  };
}
