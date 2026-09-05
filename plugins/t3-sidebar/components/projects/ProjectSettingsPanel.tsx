import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_useSidebarThreads,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { ProjectSettings } from "@/lib/project-settings";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { ProjectNewThread } from "./ProjectNewThread";

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b px-5 py-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 sm:max-w-[65%]">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="shrink-0 sm:max-w-[45%]">{children}</div>
    </div>
  );
}

export function ProjectsPanel({ subPath }: PluginNavPanelProps) {
  const { projects, status } = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const parts = subPath.split("/").filter(Boolean);
  const projectId = parts[0];
  if (projectId && parts[1] === "new")
    return <ProjectNewThread key={projectId} projectId={projectId} />;
  if (projectId)
    return <ProjectSettingsPage key={projectId} projectId={projectId} />;
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-10">
      <h1 className="mb-6 text-lg font-medium">Projects</h1>
      <div className="overflow-hidden rounded-2xl border">
        {projects
          .filter((project) => !project.isPersonal)
          .map((project) => (
            <button
              type="button"
              key={project.id}
              className="flex w-full items-center justify-between border-b px-5 py-4 text-left text-sm last:border-b-0 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() =>
                navigate.toPluginPanel("projects", { subPath: project.id })
              }
            >
              {project.name}
              <Icon
                name="ChevronRight"
                className="size-4 text-muted-foreground"
              />
            </button>
          ))}
        {status !== "ready" ? (
          <p role="status" className="p-5 text-sm text-muted-foreground">
            {status === "error"
              ? "Could not load projects."
              : "Loading projects…"}
          </p>
        ) : null}
        {status === "ready" &&
        !projects.some((project) => !project.isPersonal) ? (
          <p className="p-5 text-sm text-muted-foreground">
            Add a project using the folder button in the sidebar.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ProjectSettingsPage({ projectId }: { projectId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const portalProps = usePortalScopeProps();
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
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
    patch: Partial<
      Pick<ProjectSettings, "name" | "model" | "workspace" | "autoPull">
    >,
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
  const model = settings?.model ?? settings?.resolvedModel;
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center gap-3 border-b px-5 py-3 text-sm">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => navigate.toPluginPanel("projects")}
        >
          Projects
        </button>
        <span className="text-muted-foreground">/</span>
        <span>{settings?.name ?? "Project settings"}</span>
      </div>
      <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-10">
        {error && !confirmRemove ? (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
          >
            {error}
            {!settings ? (
              <Button
                variant="ghost"
                onClick={() => setRevision((value) => value + 1)}
              >
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        {!settings ? (
          <p role="status" className="text-sm text-muted-foreground">
            {error
              ? "Project settings unavailable."
              : "Loading project settings…"}
          </p>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between px-5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Project
              </h2>
              <span role="status" className="text-xs text-muted-foreground">
                {pending ? "Saving…" : saved ? "Saved" : ""}
              </span>
            </div>
            <section
              aria-label="Project settings"
              className="overflow-hidden rounded-2xl border"
            >
              <SettingsRow
                title="Name"
                description="The name for this project in the sidebar and thread lists."
              >
                <input
                  aria-label="Project name"
                  value={name}
                  disabled={pending}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSaved(false);
                  }}
                  onBlur={() => {
                    if (name.trim() && name.trim() !== settings.name)
                      void save({ name: name.trim() });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setName(settings.name);
                  }}
                  className="h-9 w-full rounded-lg border bg-muted/40 px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-60"
                />
              </SettingsRow>
              <SettingsRow
                title="Default model"
                description="New threads opened from T3 Sidebar start with this model and reasoning level."
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {model ? (
                    <ProviderModelPicker
                      value={model}
                      onChange={(value) => void save({ model: value })}
                      disabled={pending}
                      align="end"
                      {...(settings.hostId
                        ? {
                            routing: {
                              kind: "host" as const,
                              hostId: settings.hostId,
                            },
                          }
                        : {})}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No model available
                    </span>
                  )}
                  {settings.model ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => void save({ model: null })}
                    >
                      Reset
                    </Button>
                  ) : null}
                </div>
              </SettingsRow>
              <SettingsRow
                title="Workspace"
                description="Where new threads opened from T3 Sidebar start. You can change this before sending."
              >
                <select
                  aria-label="Default workspace"
                  value={settings.workspace}
                  disabled={pending}
                  onChange={(event) =>
                    void save({
                      workspace: event.target
                        .value as ProjectSettings["workspace"],
                    })
                  }
                  className="h-9 w-full rounded-lg border bg-muted/40 px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="default">Default</option>
                  <option value="worktree">New worktree</option>
                  <option value="local">Local checkout</option>
                </select>
              </SettingsRow>
              <SettingsRow
                title="Automatically pull"
                description="Keep the default branch current in the background when the checkout has no local changes or unpushed commits."
              >
                <button
                  type="button"
                  role="switch"
                  aria-label="Automatically pull"
                  aria-checked={settings.autoPull}
                  disabled={pending}
                  onClick={() => void save({ autoPull: !settings.autoPull })}
                  className={`inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${settings.autoPull ? "bg-primary" : "bg-muted-foreground/40"}`}
                >
                  <span
                    className={`size-5 rounded-full bg-background shadow-sm transition-transform ${settings.autoPull ? "translate-x-4" : "translate-x-0"}`}
                  />
                </button>
              </SettingsRow>
            </section>
            {settings.path ? (
              <p className="mt-4 break-all px-5 font-mono text-xs text-muted-foreground">
                {settings.path}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end">
              <Button
                variant="outline"
                onClick={() =>
                  navigate.toPluginPanel("projects", {
                    subPath: `${projectId}/new`,
                  })
                }
              >
                <Icon name="Plus" />
                New thread
              </Button>
            </div>
            <h2 className="mb-4 mt-10 px-5 text-sm font-medium text-muted-foreground">
              Danger
            </h2>
            <section
              aria-label="Danger"
              className="overflow-hidden rounded-2xl border"
            >
              <SettingsRow
                title="Remove project"
                description="Removes this project and all of its threads. This cannot be undone."
              >
                <Button
                  variant="outline"
                  disabled={pending}
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setError(null);
                    setConfirmRemove(true);
                  }}
                >
                  <Icon name="Trash2" />
                  Remove project
                </Button>
              </SettingsRow>
            </section>
          </>
        )}
      </main>
      <Dialog.Root
        open={confirmRemove}
        onOpenChange={(open) => {
          if (!pending) setConfirmRemove(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            {...portalProps}
            className="fixed inset-0 z-50 bg-black/50"
          />
          <Dialog.Content
            {...portalProps}
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl"
          >
            <Dialog.Title className="text-base font-semibold">
              Remove project?
            </Dialog.Title>
            <Dialog.Description className="mt-3 text-sm text-muted-foreground">
              Remove “{settings?.name}” and all of its threads? This cannot be
              undone.
            </Dialog.Description>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirmRemove(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => void remove()}
              >
                {pending ? "Removing…" : "Confirm removal"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
