import { useEffect, useId, useRef, useState } from "react";
import { definePluginApp, useRpc, useBbNavigate, UrlLink } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, View, ListResult } from "./contract";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";

function PullRequestList({ view }: { view: View }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [result, setResult] = useState<ListResult | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [repository, setRepository] = useState("");
  const groupId = useId();
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const reviewing = useRef(false);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    rpc.call("list", { view, page }).then(
      (data) => {
        if (disposed) return;
        setResult((previous) => ({
          ...data,
          rows:
            page === 1
              ? data.rows
              : [
                  ...new Map(
                    [...(previous?.rows ?? []), ...data.rows].map((pr) => [pr.url, pr]),
                  ).values(),
                ],
        }));
        setLoading(false);
      },
      (reason: unknown) => {
        if (disposed) return;
        setError(String(reason));
        setLoading(false);
      },
    );
    return () => {
      disposed = true;
    };
  }, [rpc, view, page, revision]);

  async function review(url: string) {
    if (reviewing.current) return;
    reviewing.current = true;
    setPending(url);
    try {
      const opened = await rpc.call("review", { url });
      if (opened.warning) toast.error(opened.warning);
      // Multirepo's documented handoff opens its PR panel after thread navigation.
      sessionStorage.setItem(`bb:multirepo:open-review:${opened.threadId}`, url);
      navigate.toThread(opened.threadId);
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      reviewing.current = false;
      setPending(null);
    }
  }
  const repositories = [...new Set(result?.rows.map((pr) => pr.repository) ?? [])].sort();
  const rows =
    result?.rows.filter(
      (pr) =>
        (!repository || pr.repository === repository) &&
        `${pr.repository} ${pr.number} ${pr.title} ${pr.author}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? [];
  const groups = new Map<string, typeof rows>();
  for (const pr of rows) {
    const group = groups.get(pr.repository);
    if (group) group.push(pr);
    else groups.set(pr.repository, [pr]);
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
        <TabsList>
          <TabsTrigger value="authored">Created by me</TabsTrigger>
          <TabsTrigger value="reviewing">Review requested</TabsTrigger>
        </TabsList>
        <select
          aria-label="Filter by repository"
          className="h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          value={repository}
          disabled={!result}
          onChange={(event) => setRepository(event.target.value)}
        >
          <option value="">All repositories</option>
          {repository && !repositories.includes(repository) ? (
            <option value={repository}>{repository}</option>
          ) : null}
          {repositories.map((repo) => (
            <option key={repo} value={repo}>
              {repo}
            </option>
          ))}
        </select>
      </div>
      <TabsContent value={view} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
          <Input
            className="max-w-md"
            aria-label="Filter loaded pull requests"
            placeholder="Filter by title, repository, author, or number…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              setPage(1);
              setResult(null);
              setRevision((v) => v + 1);
            }}
          >
            Refresh
          </Button>
          <span className="text-xs text-muted-foreground" role="status">
            {result ? `${result.rows.length} of ${result.total} PRs · @${result.viewer}` : ""}
          </span>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4" aria-busy={loading}>
          <p className="mb-4 text-sm text-muted-foreground">
            {view === "authored"
              ? "Your open pull requests, including drafts."
              : "Open pull requests awaiting review from you or a team you belong to."}
          </p>
          {error ? (
            <div role="alert" className="mb-4 text-sm text-destructive">
              {error}{" "}
              <Button variant="outline" size="sm" onClick={() => setRevision((v) => v + 1)}>
                Retry
              </Button>
              <p className="mt-2 text-muted-foreground">
                Requires Multirepo with a workspace project selected and GitHub CLI signed in on
                that machine.
              </p>
            </div>
          ) : null}
          {result?.incomplete ? (
            <p role="status" className="mb-4 text-sm text-muted-foreground">
              GitHub returned partial results or reached its 1,000-result search limit. Open GitHub
              for the complete list.
            </p>
          ) : null}
          <div className="flex flex-col gap-3">
            {[...groups].map(([repository, prs]) => {
              const expanded = !collapsedRepos.has(repository);
              const contentId = `${groupId}-${encodeURIComponent(repository)}`;
              return (
                <section
                  key={repository}
                  className="overflow-hidden rounded-md border border-border"
                >
                  <h2>
                    <Button
                      variant="ghost"
                      className="h-auto w-full justify-start gap-2 rounded-none p-3"
                      aria-expanded={expanded}
                      aria-controls={contentId}
                      onClick={() =>
                        setCollapsedRepos((current) => {
                          const next = new Set(current);
                          if (next.has(repository)) next.delete(repository);
                          else next.add(repository);
                          return next;
                        })
                      }
                    >
                      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                      <span className="min-w-0 truncate">{repository}</span>
                      <Badge variant="secondary">{prs.length}</Badge>
                    </Button>
                  </h2>
                  <div id={contentId} hidden={!expanded}>
                    <ul className="divide-y divide-border border-t border-border px-3">
                      {prs.map((pr) => (
                        <li key={pr.url} className="flex flex-wrap items-center gap-4 py-4">
                          <div className="min-w-0 flex-1 basis-60">
                            <UrlLink
                              href={pr.url}
                              className="break-words text-sm font-medium hover:underline"
                            >
                              {pr.title}
                            </UrlLink>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>
                                {pr.repository} #{pr.number}
                              </span>
                              <span>· @{pr.author}</span>
                              <time dateTime={pr.updatedAt}>
                                · Updated {new Date(pr.updatedAt).toLocaleDateString()}
                              </time>
                            </div>
                          </div>
                          <Badge variant={pr.isDraft ? "secondary" : "outline"}>
                            {pr.isDraft ? "Draft" : "Open"}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending !== null}
                            aria-label={`Review ${pr.repository} #${pr.number}`}
                            onClick={() => review(pr.url)}
                          >
                            {pending === pr.url ? "Opening review…" : "Review in thread"}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              );
            })}
          </div>
          {!loading && !error && rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-medium">
                {query || repository
                  ? "No matching pull requests"
                  : view === "authored"
                    ? "No open pull requests"
                    : "No reviews waiting for you"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {query || repository
                  ? "Try another filter or load more results."
                  : "Refresh to check for new activity."}
              </p>
            </div>
          ) : null}
          {loading ? (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              Loading pull requests…
            </p>
          ) : null}
          {result?.nextPage && !error ? (
            <div className="py-4 text-center">
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => setPage(result.nextPage ?? 1)}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </TabsContent>
    </>
  );
}

export function PullRequestsPage() {
  const [view, setView] = useState<View>("authored");
  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="px-6 pb-4 pt-6">
        <h1 className="text-xl font-semibold">Pull requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your work and reviews, across GitHub.</p>
      </header>
      <Tabs
        value={view}
        onValueChange={(value) => {
          if (value === "authored" || value === "reviewing") setView(value);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <PullRequestList key={view} view={view} />
      </Tabs>
    </main>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "pull-requests",
    title: "Pull requests",
    icon: "GitPullRequest",
    path: "prs",
    component: PullRequestsPage,
  });
});
