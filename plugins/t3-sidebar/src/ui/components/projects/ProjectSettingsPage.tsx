import { useState, type ReactNode } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { preferencesSchema } from "@/shared/project-settings-contract";
import { Schema } from "effect";
import { Button } from "@/ui/components/ui/button";
import { Icon } from "@/ui/components/ui/icon";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import { useProjectSettings } from "./useProjectSettings";

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
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0 sm:max-w-[45%]">{children}</div>
    </div>
  );
}

export function ProjectSettingsPage({ projectId }: { projectId: string }) {
  const navigate = useBbNavigate();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const {
    settings,
    name,
    setName,
    error,
    setError,
    pending,
    saved,
    setSaved,
    retry,
    save,
    remove,
  } = useProjectSettings(projectId);

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
              <Button variant="ghost" onClick={retry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        {!settings ? (
          <p role="status" className="text-sm text-muted-foreground">
            {error ? "Project settings unavailable." : "Loading project settings…"}
          </p>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between px-5">
              <h2 className="text-sm font-medium text-muted-foreground">Project</h2>
              <span role="status" className="text-xs text-muted-foreground">
                {pending ? "Saving…" : saved ? "Saved" : ""}
              </span>
            </div>
            <section aria-label="Project settings" className="overflow-hidden rounded-2xl border">
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
                    <span className="text-xs text-muted-foreground">No model available</span>
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
                      workspace: Schema.decodeUnknownSync(preferencesSchema.fields.workspace)(
                        event.target.value,
                      ),
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
            <h2 className="mb-4 mt-10 px-5 text-sm font-medium text-muted-foreground">Danger</h2>
            <section aria-label="Danger" className="overflow-hidden rounded-2xl border">
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
      <RemoveProjectDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        projectName={settings?.name}
        pending={pending}
        error={error}
        onRemove={remove}
      />
    </div>
  );
}
