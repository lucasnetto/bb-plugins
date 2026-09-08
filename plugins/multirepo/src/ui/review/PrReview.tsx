// BB adapter for T3 Code's PR code tab. Ported components retain T3-LICENSE.
import { useEffect, useState, type CSSProperties } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Button } from "../components/ui/button";
import { StyledDiffCodeView } from "./StyledDiffCodeView";
import { DiffFileTree } from "./DiffFileTree";
import { ReviewToolbar } from "./ReviewToolbar";
import { ReviewGuidePanel } from "./ReviewGuidePanel";
import { ReviewCommentForm } from "./ReviewCommentForm";
import { useGuide } from "./useGuide";
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
  const [guideRequestOpen, setGuideRequestOpen] = useState(false);
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
    selection: diff.selection.lines,
    selectionPath: diff.selection.path,
    fullDiffs: diff.files.fullDiffs,
    setNotice,
    setError,
  });
  const { clear: clearSelection, selectLines } = diff.selection;
  useEffect(() => {
    clearSelection();
    setSelectedPath(null);
  }, [guideOpen, guide.data?.id, clearSelection, setSelectedPath]);
  function toggleGuide() {
    setGuideOpen(!guideOpen);
    diff.files.expandAll();
  }
  const unavailable = selectedPath && !diff.files.hasReadablePatch(selectedPath);
  return (
    <section
      aria-label="Pull request code review"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      style={
        {
          "--code-background": "var(--background)",
          "--code-foreground": "var(--foreground)",
          colorScheme: diff.viewer.mode,
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
            <UrlLink href={url} data-pr-browser>
              Open on GitHub ↗
            </UrlLink>
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
      <ReviewToolbar
        fileCount={detail?.files.length ?? 0}
        guideOpen={guideOpen}
        onToggleGuide={toggleGuide}
        treeOpen={treeOpen}
        onToggleTree={() => setTreeOpen(!treeOpen)}
        loading={loading}
        refresh={refresh}
        display={diff.display}
      />
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
        <ReviewGuidePanel
          threadId={threadId}
          guideRequestOpen={guideRequestOpen}
          setGuideRequestOpen={setGuideRequestOpen}
          guide={guide}
          diff={diff}
          staleGuide={staleGuide}
          loading={loading}
          hasChangedFiles={!!detail?.files.length}
          selectedPath={selectedPath}
          setSelectedPath={setSelectedPath}
          onSelection={selectLines}
        />
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
                viewerRef={diff.viewer.ref}
                className="h-full overflow-auto [scrollbar-gutter:stable]"
                items={diff.viewer.items}
                options={diff.viewer.options}
                selectedLines={diff.selection.lines}
                onSelectedLinesChange={selectLines}
                renderHeaderPrefix={diff.viewer.header}
              />
            )}
            {!loading && detail?.files.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No changed files.</p>
            ) : null}
          </div>
          {treeOpen ? (
            <aside className="flex min-h-0 w-[35%] min-w-36 max-w-72 shrink-0 border-l border-border">
              <DiffFileTree
                entries={diff.files.entries}
                onSelectFile={diff.files.reveal}
                selectedPath={selectedPath}
                ariaLabel="Changed files"
              />
            </aside>
          ) : null}
        </div>
      ) : null}
      {diff.selection.lines || draft.comment ? (
        <ReviewCommentForm
          threadId={threadId}
          pullRequestNumber={detail?.pr.number}
          hasDetail={!!detail}
          hasSelection={!!diff.selection.lines}
          loading={loading}
          draft={draft}
        />
      ) : null}
      <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-3 py-2">
        <span
          className="mr-auto min-w-0 truncate text-xs text-muted-foreground"
          title={selectedPath ?? undefined}
        >
          {diff.selection.lines
            ? `${diff.selection.path} · ${diff.selection.lines.range.start}–${diff.selection.lines.range.end}`
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
        {diff.selection.lines ? (
          <Button size="sm" variant="ghost" onClick={diff.selection.clear}>
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
