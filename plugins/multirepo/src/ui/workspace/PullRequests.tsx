import { useCallback, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { useLoad } from "../hooks/useLoad";
import { Blank, Loading, ErrorMessage } from "../components/LoadState";
import { useRpc, useBbNavigate, experimental_Diff as Diff, UrlLink } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Repo, PullRequest } from "../../shared/contract";
import { Badge } from "../components/ui/badge";

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
export function PullRequests({ repos, revision }: { repos: Repo[]; revision: number }) {
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
