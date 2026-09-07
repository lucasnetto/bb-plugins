// BB adapter for T3 Code's PR code tab. Ported components retain T3-LICENSE.
import { useEffect, useState, type CSSProperties } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Button } from "../components/ui/button";
import { StyledDiffCodeView } from "./StyledDiffCodeView";
import { DiffFileTree } from "./DiffFileTree";
import { GuideGenerator } from "./GuideGenerator";
import { useGuide } from "./useGuide";
import { GuidedReview } from "./GuidedReview";
import { useReviewData } from "./useReviewData";
import { useReviewDiff } from "./useReviewDiff";
import { useReviewComposer } from "./useReviewComposer";

export function PrReview({ threadId, url }: { threadId: string; url: string }) {
  return <PrReviewContent key={`${threadId}:${url}`} threadId={threadId} url={url} />;
}
function PrReviewContent({ threadId, url }: { threadId: string; url: string }) {
  const { detail, error, setError, loading, revision, refresh, selectedPath, setSelectedPath } =
    useReviewData(threadId, url);
  const [notice, setNotice] = useState("");
  const [treeOpen, setTreeOpen] = useState(true);
  const guide = useGuide(threadId, url, revision);
  const [guideOpen, setGuideOpen] = useState(false);
  const staleGuide =
    !!guide.data &&
    !!detail &&
    (guide.data.base !== detail.baseRefOid || guide.data.head !== detail.headRefOid);
  const diff = useReviewDiff({
    detail,
    threadId,
    url,
    revision,
    setSelectedPath,
    setNotice,
    setError,
  });
  const draft = useReviewComposer({
    threadId,
    url,
    detail,
    selectedPath,
    selection: diff.selection,
    selectionPath: diff.selectionPath,
    fullDiffs: diff.fullDiffs,
    setNotice,
    setError,
  });
  const { setSelection } = diff;
  useEffect(() => {
    setSelection(null);
    setSelectedPath(null);
  }, [guideOpen, guide.data?.id, setSelection, setSelectedPath]);
  const unavailable = selectedPath && !diff.parsed.some((item) => item.id === selectedPath);
  return (
    <section
      aria-label="Pull request code review"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      style={
        {
          "--code-background": "var(--background)",
          "--code-foreground": "var(--foreground)",
          colorScheme: diff.mode,
        } as CSSProperties
      }
    >
      <header
        hidden={guideOpen && !!guide.data}
        className="shrink-0 border-b border-border px-4 py-3"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {detail?.pr.repository} #{detail?.pr.number}
          </span>
          <span>{detail?.pr.state.toLowerCase()}</span>
          <span className="ml-auto">
            <UrlLink href={url}>Open on GitHub ↗</UrlLink>
          </span>
        </div>
        <h2 className="mt-2 truncate text-sm font-semibold" title={detail?.pr.title}>
          {detail?.pr.title ?? "Loading pull request…"}
        </h2>
        {detail ? (
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {detail.baseRefName} ← {detail.headRefName}
          </p>
        ) : null}
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <span className="mr-auto px-2 text-xs font-medium">
          Code <span className="text-muted-foreground">{detail?.files.length ?? 0}</span>
        </span>
        <Button
          size="sm"
          variant={guideOpen ? "secondary" : "ghost"}
          aria-pressed={guideOpen}
          onClick={() => {
            setGuideOpen(!guideOpen);
            diff.setCollapsed(new Set());
          }}
        >
          Guide
        </Button>
        <Button
          size="sm"
          variant={diff.style === "unified" ? "secondary" : "ghost"}
          aria-pressed={diff.style === "unified"}
          onClick={() => diff.setStyle("unified")}
        >
          Unified
        </Button>
        <Button
          size="sm"
          variant={diff.style === "split" ? "secondary" : "ghost"}
          aria-pressed={diff.style === "split"}
          onClick={() => diff.setStyle("split")}
        >
          Split
        </Button>
        <Button
          size="sm"
          variant={diff.wrap ? "secondary" : "ghost"}
          aria-pressed={diff.wrap}
          onClick={() => diff.setWrap(!diff.wrap)}
        >
          Wrap
        </Button>
        <Button
          size="sm"
          variant={treeOpen ? "secondary" : "ghost"}
          aria-pressed={treeOpen}
          onClick={() => setTreeOpen(!treeOpen)}
        >
          Files
        </Button>
        <Button size="sm" variant="ghost" disabled={loading} onClick={refresh}>
          Refresh
        </Button>
        <Button size="sm" variant="ghost" disabled={loading} onClick={diff.expandContext}>
          Expand context
        </Button>
        <Button size="sm" variant="ghost" onClick={diff.collapseContext}>
          Collapse context
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            diff.setCollapsed(
              diff.collapsed.size === diff.parsed.length
                ? new Set()
                : new Set(diff.parsed.map((item) => item.id)),
            )
          }
        >
          {diff.parsed.length && diff.collapsed.size === diff.parsed.length
            ? "Expand all"
            : "Collapse all"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading diff…
        </p>
      ) : null}
      {guideOpen ? (
        <>
          <GuideGenerator
            threadId={threadId}
            open={guide.requestOpen}
            onOpenChange={guide.setRequestOpen}
            pending={guide.pending}
            onStart={guide.start}
          />
          {guide.error ? (
            <p role="alert" className="px-4 py-2 text-sm text-destructive">
              {guide.error}
            </p>
          ) : null}
          {guide.generating ? (
            <p role="status" className="px-4 py-2 text-sm text-muted-foreground">
              Generating review guide…{" "}
              <Button
                size="sm"
                variant="outline"
                disabled={guide.pending}
                onClick={() => void guide.cancel()}
              >
                Cancel generation
              </Button>
            </p>
          ) : null}
          {guide.data ? (
            <GuidedReview
              saved={guide.data}
              items={diff.items}
              stale={staleGuide || loading}
              pending={guide.pending || guide.generating || guide.loading || loading}
              onRequest={guide.request}
              onMark={(index, reviewed) => void guide.mark(index, reviewed)}
              selectedPath={selectedPath}
              onSelectPath={setSelectedPath}
              options={diff.options}
              selection={diff.selection}
              onSelection={(next) => {
                diff.setSelection(next ?? null);
                if (next)
                  setSelectedPath(
                    diff.items.find((item) => item.id === next.id)?.fileDiff.name ?? null,
                  );
                setNotice("");
              }}
              header={diff.header}
            />
          ) : (
            <div className="flex flex-1 flex-col items-start justify-center gap-3 p-6">
              <h3 className="text-lg font-semibold">
                {staleGuide ? "The PR has changed" : "Review the story behind this change"}
              </h3>
              <p className="max-w-lg text-sm text-muted-foreground">
                {staleGuide
                  ? "This guide belongs to an earlier revision. Generate a new guide to review the current diff."
                  : "Organize the diff into chapters: the core change first, its consequences next, then wiring and housekeeping."}
              </p>
              <Button
                disabled={
                  loading ||
                  guide.loading ||
                  guide.pending ||
                  guide.generating ||
                  !detail?.files.length
                }
                onClick={guide.request}
              >
                {guide.pending ? "Starting…" : staleGuide ? "Regenerate guide" : "Generate guide"}
              </Button>
              <p className="text-xs text-muted-foreground">Choose a model before generating.</p>
            </div>
          )}
        </>
      ) : null}
      {!guideOpen ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="relative min-h-0 min-w-0 flex-1">
            {unavailable ? (
              <div className="p-4 text-sm">
                <p className="mb-2 break-all">{selectedPath}</p>
                <p className="text-muted-foreground">
                  GitHub did not provide a readable patch for this file.
                </p>
                <UrlLink href={`${url}/files`}>Open file on GitHub ↗</UrlLink>
              </div>
            ) : (
              <StyledDiffCodeView
                viewerRef={diff.viewer}
                className="h-full overflow-auto [scrollbar-gutter:stable]"
                items={diff.items}
                options={diff.options}
                selectedLines={diff.selection}
                onSelectedLinesChange={(next) => {
                  diff.setSelection(next);
                  if (next)
                    setSelectedPath(
                      diff.items.find((item) => item.id === next.id)?.fileDiff.name ?? null,
                    );
                  setNotice("");
                }}
                renderHeaderPrefix={diff.header}
              />
            )}
            {!loading && detail?.files.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No changed files.</p>
            ) : null}
          </div>
          {treeOpen ? (
            <aside className="flex min-h-0 w-[35%] min-w-36 max-w-72 shrink-0 border-l border-border">
              <DiffFileTree
                entries={diff.entries}
                onSelectFile={diff.reveal}
                selectedPath={selectedPath}
                ariaLabel="Changed files"
              />
            </aside>
          ) : null}
        </div>
      ) : null}
      {diff.selection || draft.comment ? (
        <form
          className="shrink-0 space-y-2 border-t border-border px-3 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (diff.selection && draft.comment.trim() && !loading && !draft.addingComment)
              void draft.add("Comment");
          }}
        >
          <label
            className="block text-xs font-medium"
            htmlFor={`review-comment-${threadId}-${detail?.pr.number}`}
          >
            Comment on selected code
          </label>
          <textarea
            id={`review-comment-${threadId}-${detail?.pr.number}`}
            rows={3}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="What should the agent check or change?"
            value={draft.comment}
            onChange={(event) => draft.setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.metaKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {diff.selection
                ? "Adds your comment and selected code to this chat."
                : "Select lines to attach this comment."}
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={
                loading ||
                draft.addingComment ||
                !detail ||
                !diff.selection ||
                !draft.comment.trim()
              }
            >
              Add to chat ⌘↵
            </Button>
          </div>
        </form>
      ) : null}
      <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-3 py-2">
        <span
          className="mr-auto min-w-0 truncate text-xs text-muted-foreground"
          title={selectedPath ?? undefined}
        >
          {diff.selection
            ? `${diff.selectionPath} · ${diff.selection.range.start}–${diff.selection.range.end}`
            : (selectedPath ?? "Select a file or lines")}
        </span>
        {(["Ask", "Explain", "Fix"] as const).map((action) => (
          <Button
            key={action}
            size="sm"
            variant="ghost"
            disabled={loading || draft.addingComment || !detail}
            onClick={() => draft.add(action)}
          >
            {action}
          </Button>
        ))}
        {diff.selection ? (
          <Button size="sm" variant="ghost" onClick={() => diff.setSelection(null)}>
            Clear selection
          </Button>
        ) : null}
        {notice ? (
          <span role="status" className="w-full text-xs text-muted-foreground">
            {notice}
          </span>
        ) : null}
      </footer>
    </section>
  );
}
