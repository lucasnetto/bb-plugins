import { useRef, useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { Icon } from "@/ui/components/ui/icon";
import { cn } from "@/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";

export function ProjectScopePicker(props: {
  projects: readonly { id: string; name: string; isPersonal: boolean }[];
  scopeProjectId: string | null;
  onChange: (projectId: string | null) => void;
  onNewThread: () => void;
  onAddProject: () => void;
  onProjectSettings: (project: { id: string; name: string }) => void;
}) {
  const scoped = props.projects.find((project) => project.id === props.scopeProjectId) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const openingSettings = useRef(false);

  const matchingProjects = props.projects.filter((project) =>
    project.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex items-center gap-1 px-1.5 pb-1 pt-1.5">
      <DropdownMenu
        open={open}
        onOpenChange={(value) => {
          setOpen(value);

          if (value) {
            setQuery("");
            openingSettings.current = false;
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Filter threads by project"
            className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-foreground/90 outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-state-active"
          >
            <Icon name="Folder" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{scoped?.name ?? "All projects"}</span>
            <Icon name="ChevronDown" className="-mr-px size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-56"
          onCloseAutoFocus={(event) => {
            if (openingSettings.current) event.preventDefault();
          }}
        >
          <input
            aria-label="Search projects"
            placeholder="Search projects…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
            }}
            className="mb-1 h-8 w-full border-b bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
          />
          <DropdownMenuItem
            onSelect={() => props.onChange(null)}
            className={cn(props.scopeProjectId === null && "font-medium")}
          >
            <Icon name="Folder" className="size-4" />
            All projects
          </DropdownMenuItem>
          {props.projects.length > 0 ? <DropdownMenuSeparator /> : null}
          {matchingProjects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={(event) => {
                if (openingSettings.current) event.preventDefault();
                else props.onChange(project.id);
              }}
              className={cn(project.id === props.scopeProjectId && "font-medium")}
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-muted text-[9px] font-semibold text-muted-foreground">
                {project.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {!project.isPersonal ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`Project settings for ${project.name}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    openingSettings.current = true;
                    setOpen(false);
                    props.onProjectSettings(project);
                  }}
                >
                  <Icon name="Settings" className="size-3.5" />
                </Button>
              ) : null}
            </DropdownMenuItem>
          ))}
          {!matchingProjects.length ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No matching projects.</p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground"
        aria-label="New project"
        onClick={props.onAddProject}
      >
        <Icon name="FolderPlus" className="size-4" />
      </Button>
      {scoped ? (
        <button
          type="button"
          aria-label={`New thread in ${scoped.name}`}
          title={`New thread in ${scoped.name}`}
          onClick={props.onNewThread}
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="Plus" className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
