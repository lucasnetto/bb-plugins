import { LinkedPrsPanel, LinkedPrHeader } from "./linked-prs";
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useBbNavigate,
  experimental_Diff as Diff,
  experimental_SourceCode as SourceCode,
  experimental_FileLink as FileLink,
  UrlLink,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, Repo, PullRequest, Change, Detail } from "./contract";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Badge } from "./components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./components/ui/empty";
import { Skeleton } from "./components/ui/skeleton";
import { cn } from "./lib/utils";

function useLoad<T>(load: () => Promise<T>, revision = 0) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  useEffect(() => {
    let current = true;
    setState({ loading: true });
    load().then(
      (data) => {
        if (current) setState({ data, loading: false });
      },
      (error) => {
        if (current)
          setState({
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          });
      },
    );
    return () => {
      current = false;
    };
  }, [load, revision]);
  return state;
}
function ErrorMessage({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Couldn’t load this view</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
function Blank({ title, description }: { title: string; description?: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}
function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 p-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-8 w-1/2" />
    </div>
  );
}

function FilePreview({
  repo,
  path,
  mode,
  hostId,
  root,
  revision,
}: {
  repo: string;
  path: string;
  mode: "staged" | "worktree" | "source";
  hostId: string;
  root: string;
  revision: number;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => rpc.call("detail", { repo, path, mode }), [rpc, repo, path, mode]);
  const state = useLoad<Detail>(load, revision);
  const [view, setView] = useState<"unified" | "split">("unified");
  return (
    <section className="min-w-0 flex-1 overflow-auto" aria-label="File preview">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <span className="break-all font-mono text-xs">{path}</span>
        <div className="flex items-center gap-3">
          {mode !== "source" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView((v) => (v === "split" ? "unified" : "split"))}
            >
              {view === "split" ? "Unified diff" : "Split diff"}
            </Button>
          ) : null}
          <FileLink
            target={{ kind: "host", hostId, path: `${root}/${repo}/${path}` }}
            className="text-sm underline"
          >
            Open file
          </FileLink>
        </div>
      </div>
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorMessage message={state.error} />
      ) : state.data ? (
        <>
          {state.data.notice ? <Blank title={state.data.notice} /> : null}
          {state.data.patch ? <Diff patch={state.data.patch} path={path} view={view} /> : null}
          {state.data.content !== null ? (
            <SourceCode content={state.data.content} path={path} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
function FilesView({
  repo,
  mode,
  root,
  hostId,
  revision,
}: {
  repo: string;
  mode: "changes" | "files";
  root: string;
  hostId: string;
  revision: number;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    path: string;
    mode: "staged" | "worktree" | "source";
  } | null>(null);
  const load = useCallback(
    async () =>
      mode === "changes"
        ? {
            changes: await rpc.call("changes", { repo }),
            files: [] as string[],
          }
        : { changes: [] as Change[], files: await rpc.call("files", { repo }) },
    [rpc, repo, mode],
  );
  const state = useLoad(load, revision);
  const matches = (path: string) => path.toLowerCase().includes(query.toLowerCase());
  function entry(path: string, label: string, fileMode: "staged" | "worktree" | "source") {
    return (
      <button
        key={`${fileMode}:${path}`}
        className={cn(
          "flex w-full items-start gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent focus-visible:outline focus-visible:outline-ring",
          selected?.path === path && selected.mode === fileMode && "bg-accent",
        )}
        onClick={() => setSelected({ path, mode: fileMode })}
      >
        <span className="w-4 shrink-0 text-muted-foreground">{label}</span>
        <span className="break-all font-mono">{path}</span>
      </button>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="max-h-72 shrink-0 overflow-auto border-b border-border p-3 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
        <Input
          aria-label="Filter files"
          placeholder="Filter files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {state.loading ? (
          <Loading />
        ) : state.error ? (
          <ErrorMessage message={state.error} />
        ) : state.data ? (
          <div className="mt-3">
            {mode === "files" ? (
              state.data.files.filter(matches).map((path) => entry(path, "", "source"))
            ) : (
              <>
                <p className="py-2 text-xs font-medium text-muted-foreground">Staged</p>
                {state.data.changes
                  .filter((c) => c.index !== " " && c.index !== "?")
                  .filter((c) => matches(c.path))
                  .map((c) => entry(c.path, c.index, "staged"))}
                <p className="py-2 text-xs font-medium text-muted-foreground">Working tree</p>
                {state.data.changes
                  .filter((c) => c.worktree !== " ")
                  .filter((c) => matches(c.path))
                  .map((c) => entry(c.path, c.worktree, c.index === "?" ? "source" : "worktree"))}
                {state.data.changes.length === 0 ? <Blank title="Working tree clean" /> : null}
              </>
            )}
          </div>
        ) : null}
      </div>
      {selected ? (
        <FilePreview {...selected} repo={repo} root={root} hostId={hostId} revision={revision} />
      ) : (
        <Blank
          title="Select a file"
          description={
            mode === "changes"
              ? "Choose a staged or working-tree change to inspect."
              : "Tracked and untracked files are listed; ignored files are excluded."
          }
        />
      )}
    </div>
  );
}
function PullRequestDetail({ repo, pr }: { repo: string; pr: PullRequest }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const load = useCallback(
    () => rpc.call("prFiles", { repo, number: pr.number }),
    [rpc, repo, pr.number],
  );
  const state = useLoad(load);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = state.data?.find((f) => f.path === selected);
  async function review() {
    setPending(true);
    setError(null);
    try {
      const result = await rpc.call("review", { repo, number: pr.number });
      navigate.toThread(result.threadId);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
        <div>
          <UrlLink href={pr.url} className="text-sm font-medium underline">
            #{pr.number} {pr.title}
          </UrlLink>
          <p className="text-xs text-muted-foreground">
            {pr.headRefName} → {pr.baseRefName} · {pr.author}
          </p>
        </div>
        <Button size="sm" disabled={pending} onClick={review}>
          {pending ? "Starting review…" : "Start review"}
        </Button>
      </div>
      {error ? <ErrorMessage message={error} /> : null}
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorMessage message={state.error} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="max-h-72 overflow-auto border-b border-border p-2 lg:max-h-none lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r">
            {state.data?.map((f) => (
              <button
                key={f.path}
                onClick={() => setSelected(f.path)}
                className={cn(
                  "block w-full break-all rounded p-2 text-left font-mono text-xs hover:bg-accent",
                  f.path === selected && "bg-accent",
                )}
              >
                {f.path}
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-auto">
            {file ? (
              file.patch ? (
                <Diff path={file.path} patch={file.patch} />
              ) : (
                <Blank
                  title="No text patch available"
                  description="GitHub omits patches for binary files and some large changes. Open the PR on GitHub to inspect it."
                />
              )
            ) : (
              <Blank title="Select a changed file" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function PullRequests({ repos, revision }: { repos: Repo[]; revision: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    repo: string;
    pr: PullRequest;
  } | null>(null);
  const load = useCallback(
    () =>
      Promise.all(
        repos
          .filter((r) => r.remote)
          .map(async (repo) => {
            try {
              return {
                repo: repo.name,
                prs: await rpc.call("prs", { repo: repo.name }),
                error: null,
              };
            } catch (e) {
              return {
                repo: repo.name,
                prs: [] as PullRequest[],
                error: String(e),
              };
            }
          }),
      ),
    [rpc, repos],
  );
  const state = useLoad(load, revision);
  if (selected)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="p-2">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            ← Pull requests
          </Button>
        </div>
        <PullRequestDetail key={`${selected.repo}:${selected.pr.number}`} {...selected} />
      </div>
    );
  const rows = state.data
    ?.flatMap((group) => group.prs.map((pr) => ({ repo: group.repo, pr })))
    .filter((row) =>
      `${row.repo} ${row.pr.number} ${row.pr.title}`.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <div className="flex-1 overflow-auto p-4">
      <Input
        aria-label="Filter pull requests"
        placeholder="Filter by repository, title, or number…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorMessage message={state.error} />
      ) : (
        <>
          {state.data
            ?.filter((g) => g.error)
            .map((g) => (
              <div key={g.repo} className="mt-3">
                <ErrorMessage message={`${g.repo}: ${g.error}`} />
              </div>
            ))}
          <div className="mt-3 flex flex-col divide-y divide-border">
            {rows?.map(({ repo, pr }) => (
              <button
                key={`${repo}:${pr.number}`}
                onClick={() => setSelected({ repo, pr })}
                className="flex items-center justify-between gap-3 p-3 text-left hover:bg-accent"
              >
                <div>
                  <p className="text-sm font-medium">{pr.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {repo} · #{pr.number} · {pr.author}
                  </p>
                </div>
                {pr.isDraft ? <Badge variant="secondary">Draft</Badge> : null}
              </button>
            ))}
          </div>
          {rows?.length === 0 ? <Blank title="No matching open pull requests" /> : null}
        </>
      )}
    </div>
  );
}
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
function Workspace({ initialView = "repos" }: { initialView?: "repos" | "prs" }) {
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
function ReposPage() {
  return <Workspace />;
}
function InboxPage() {
  return <Workspace initialView="prs" />;
}
export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "linked-prs",
    title: "Linked PRs",
    component: LinkedPrHeader,
  });
  app.slots.threadPanelAction({
    id: "linked-prs",
    title: "Linked PRs",
    icon: "GitPullRequest",
    layout: "flush",
    component: LinkedPrsPanel,
  });
  app.slots.commandPaletteAction({
    id: "linked-prs",
    title: "Open linked PRs",
    isAvailable: (ctx) => !!ctx.threadId,
    run: (ctx) => {
      ctx.openPanel({ actionId: "linked-prs" });
    },
  });
  app.slots.navPanel({
    id: "repos",
    title: "Repos",
    icon: "FolderGit2",
    path: "repos",
    component: ReposPage,
  });
  app.slots.navPanel({
    id: "pr-inbox",
    title: "PR inbox",
    icon: "GitPullRequest",
    path: "prs",
    component: InboxPage,
  });
  app.slots.threadPanelAction({
    id: "repos",
    title: "Repos",
    icon: "FolderGit2",
    layout: "flush",
    component: ReposPage,
  });
});
