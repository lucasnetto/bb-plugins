import { useCallback, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { useLoad } from "../hooks/useLoad";
import { Blank, Loading, ErrorMessage } from "../components/LoadState";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Repo } from "../../shared/contract";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { FilesView } from "./FilesView";
import { PullRequests } from "./PullRequests";

function RepositoryView({
  repo,
  root,
  hostId,
  revision,
}: {
  repo: Repo;
  root: string;
  hostId: string;
  revision: number;
}) {
  const [tab, setTab] = useState("changes");
  // Stable identity keeps PR queries from restarting on unrelated UI state changes.
  const [singleRepo] = useState(() => [repo]);
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <div>
          <p className="text-sm font-medium">{repo.name}</p>
          <p className="text-xs text-muted-foreground">{repo.branch}</p>
        </div>
        <TabsList>
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="prs">Pull requests</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="changes" className="flex min-h-0 flex-1 flex-col">
        <FilesView
          repo={repo.name}
          mode="changes"
          root={root}
          hostId={hostId}
          revision={revision}
        />
      </TabsContent>
      <TabsContent value="files" className="flex min-h-0 flex-1 flex-col">
        <FilesView repo={repo.name} mode="files" root={root} hostId={hostId} revision={revision} />
      </TabsContent>
      <TabsContent value="prs" className="flex min-h-0 flex-1 flex-col">
        <PullRequests repos={singleRepo} revision={revision} />
      </TabsContent>
    </Tabs>
  );
}
export function Workspace({ initialView = "repos" }: { initialView?: "repos" | "prs" }) {
  const rpc = useRpc<typeof rpcContract>();
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [workspace, repos] = await Promise.all([rpc.call("workspace"), rpc.call("discover")]);
    return { workspace, repos };
  }, [rpc]);
  const state = useLoad(load, revision);
  const repo = state.data?.repos.find((r) => r.name === selected);
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {state.data?.workspace.name ?? "Workspace repositories"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {state.data
              ? `${state.data.repos.length} repositories · ${state.data.workspace.root}`
              : "Files, changes, and pull requests"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={state.loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          Refresh
        </Button>
      </div>
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <div className="p-4">
          <ErrorMessage message={state.error} />
        </div>
      ) : state.data ? (
        initialView === "prs" ? (
          <PullRequests repos={state.data.repos} revision={revision} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside
              aria-label="Repositories"
              className="max-h-64 shrink-0 overflow-auto border-b border-border p-3 md:max-h-none md:w-60 md:border-b-0 md:border-r"
            >
              <Input
                aria-label="Filter repositories"
                placeholder="Find a repository…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="mt-3 flex flex-col gap-1">
                {state.data.repos
                  .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
                  .map((r) => (
                    <button
                      key={r.name}
                      onClick={() => setSelected(r.name)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded p-2 text-left hover:bg-accent",
                        selected === r.name && "bg-accent",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.error ? "Unavailable" : r.branch}
                        </p>
                      </div>
                      {r.changes ? <Badge variant="secondary">{r.changes}</Badge> : null}
                    </button>
                  ))}
              </div>
            </aside>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              {repo ? (
                repo.error ? (
                  <ErrorMessage message={repo.error} />
                ) : (
                  <RepositoryView
                    key={repo.name}
                    repo={repo}
                    root={state.data.workspace.root}
                    hostId={state.data.workspace.hostId}
                    revision={revision}
                  />
                )
              ) : (
                <Blank
                  title={state.data.repos.length ? "Choose a repository" : "No repositories found"}
                  description="Browse files, inspect changes, or review a pull request."
                />
              )}
            </main>
          </div>
        )
      ) : null}
    </div>
  );
}
