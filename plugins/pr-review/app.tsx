import { useEffect, useRef, useState } from "react";
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
  const rows =
    result?.rows.filter((pr) =>
      `${pr.repository} ${pr.number} ${pr.title} ${pr.author}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
              Requires Multirepo with a workspace project selected and GitHub CLI signed in on that
              machine.
            </p>
          </div>
        ) : null}
        {result?.incomplete ? (
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            GitHub returned partial results or reached its 1,000-result search limit. Open GitHub
            for the complete list.
          </p>
        ) : null}
        <ul className="divide-y divide-border">
          {rows.map((pr) => (
            <li key={pr.url} className="flex flex-wrap items-center gap-4 py-4">
              <div className="min-w-0 flex-1 basis-60">
                <UrlLink href={pr.url} className="break-words text-sm font-medium hover:underline">
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
        {!loading && !error && rows.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-medium">
              {query
                ? "No matching pull requests"
                : view === "authored"
                  ? "No open pull requests"
                  : "No reviews waiting for you"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {query
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
    </div>
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
        <div className="px-6 pb-4">
          <TabsList>
            <TabsTrigger value="authored">Created by me</TabsTrigger>
            <TabsTrigger value="reviewing">Review requested</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value={view} className="flex min-h-0 flex-1 flex-col">
          <PullRequestList key={view} view={view} />
        </TabsContent>
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
