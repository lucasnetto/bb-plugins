import {
  experimental_useSidebarThreads,
  useBbNavigate,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/ui/components/ui/icon";
import { ProjectNewThread } from "./ProjectNewThread";
import { ProjectSettingsPage } from "./ProjectSettingsPage";

export function ProjectsPanel({ subPath }: PluginNavPanelProps) {
  const { projects, status } = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const parts = subPath.split("/").filter(Boolean);
  const projectId = parts[0];
  if (projectId && parts[1] === "new")
    return <ProjectNewThread key={projectId} projectId={projectId} />;
  if (projectId) return <ProjectSettingsPage key={projectId} projectId={projectId} />;
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
              onClick={() => navigate.toPluginPanel("projects", { subPath: project.id })}
            >
              {project.name}
              <Icon name="ChevronRight" className="size-4 text-muted-foreground" />
            </button>
          ))}
        {status !== "ready" ? (
          <p role="status" className="p-5 text-sm text-muted-foreground">
            {status === "error" ? "Could not load projects." : "Loading projects…"}
          </p>
        ) : null}
        {status === "ready" && !projects.some((project) => !project.isPersonal) ? (
          <p className="p-5 text-sm text-muted-foreground">
            Add a project using the folder button in the sidebar.
          </p>
        ) : null}
      </div>
    </div>
  );
}
