import { useGithubReview } from "./useGithubReview";
import { GithubReviewPanel } from "./GithubReviewPanel";
import { githubSelection } from "./githubSelection";
// BB adapter for T3 Code's PR code tab. Ported components retain T3-LICENSE.
import { useState, type CSSProperties } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Button } from "../components/ui/button";
import { StyledDiffCodeView } from "./StyledDiffCodeView";
import { DiffFileTree } from "./DiffFileTree";
import { ResizableFilesSidebar } from "./ResizableFilesSidebar";
import { ReviewToolbar } from "./ReviewToolbar";
import { ReviewGuidePanel } from "./ReviewGuidePanel";
import { ReviewCommentForm } from "./ReviewCommentForm";
import { useGuide } from "./useGuide";
import { useReviewData } from "./useReviewData";
import { useReviewDiff, type ReviewAnnotationRenderer } from "./useReviewDiff";
import { useReviewComposer } from "./useReviewComposer";
import { PullRequestDetail } from "../workspace/PullRequestDetail";

export function PrReview({ threadId, url }: { threadId: string; url: string }) {
  return (
    <PullRequestDetail
      key={`${threadId}:${url}`}
      threadId={threadId}
      url={url}
      code={<PrReviewContent threadId={threadId} url={url} />}
    />
  );
}
export function StandalonePrReview({ url, active = true }: { url: string; active?: boolean }) {
  return (
    <PullRequestDetail
      key={url}
      threadId={null}
      url={url}
      active={active}
      code={<PrReviewContent threadId={null} url={url} />}
    />
  );
}
function PrReviewContent({ threadId, url }: { threadId: string | null; url: string }) {
  const { detail, error, setError, loading, revision, refresh, selectedPath, setSelectedPath } =
    useReviewData(threadId, url);
  const github = useGithubReview(threadId, url);
  const [notice, setNotice] = useState("");
  const [noticeRevision, setNoticeRevision] = useState(revision);
  if (noticeRevision !== revision) {
    setNoticeRevision(revision);
    setNotice("");
  }
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState<number | null>(null);
  const guide = useGuide(threadId, url, revision);
  const [guideRequestOpen, setGuideRequestOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const staleGuide =
    !!guide.data &&
    !!detail &&
    (guide.data.base !== detail.baseRefOid || guide.data.head !== detail.headRefOid);
  const diff = useReviewDiff({
    comments: github.state?.head === detail?.headRefOid ? github.state?.comments : undefined,
    pendingReviewId: github.state?.pending?.id,
    onOpenReview: () => github.setOpen(true),
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
  const guideId = guide.data?.id;
  const [previousGuideId, setPreviousGuideId] = useState(guideId);
  if (guideId !== previousGuideId) {
    setPreviousGuideId(guideId);
    // These hooks own local state; invalidate it before rendering a replacement
    // guide, while preserving code selection when a guide arrives in the background.
    if (guideOpen) {
      clearSelection();
      setSelectedPath(null);
    }
  }
  function toggleGuide() {
    clearSelection();
    setSelectedPath(null);
    setGuideOpen(!guideOpen);
    diff.files.expandAll();
  }
  const unavailable = selectedPath && !diff.files.hasReadablePatch(selectedPath);
  const commentForm = diff.selection.lines ? (
    <ReviewCommentForm
      threadId={threadId}
      pullRequestNumber={detail?.pr.number}
      hasDetail={!!detail}
      loading={loading}
      draft={draft}
      githubDisabled={github.busy || !github.synced || !github.state}
      onClose={clearSelection}
      onAddToReview={async () => {
        if (!github.state || !diff.selection.lines || !diff.selection.path || !detail?.headRefOid)
          return;
        try {
          const body = draft.comment;
          const position = githubSelection(diff.selection.lines.range);
          if (
            await github.mutate({
              kind: "add",
              login: github.state.login,
              reviewId: github.state.pending?.id ?? null,
              head: detail.headRefOid,
              path: diff.selection.path,
              body,
              ...position,
            })
          ) {
            draft.setComment((current) => (current === body ? "" : current));
            clearSelection();
          }
        } catch (cause) {
          setError(String(cause));
        }
      }}
    />
  ) : null;
  const renderAnnotation: ReviewAnnotationRenderer = (anchor, item) =>
    diff.viewer.annotation(anchor, item, commentForm);
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
      <ReviewToolbar
        fileCount={detail?.files.length ?? 0}
        guideOpen={guideOpen}
        onToggleGuide={threadId ? toggleGuide : undefined}
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
      {guideOpen && threadId ? (
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
          annotation={renderAnnotation}
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
                renderAnnotation={renderAnnotation}
              />
            )}
            {!loading && detail?.files.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No changed files.</p>
            ) : null}
          </div>
          {treeOpen ? (
            <ResizableFilesSidebar width={treeWidth} onWidthChange={setTreeWidth}>
              <DiffFileTree
                entries={diff.files.entries}
                onSelectFile={diff.files.reveal}
                selectedPath={selectedPath}
                ariaLabel="Changed files"
              />
            </ResizableFilesSidebar>
          ) : null}
        </div>
      ) : null}
      <GithubReviewPanel head={detail?.headRefOid} review={github} onReveal={diff.files.reveal} />
      <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-3 py-2">
        <span
          className="mr-auto min-w-0 truncate text-xs text-muted-foreground"
          title={selectedPath ?? undefined}
        >
          {diff.selection.lines
            ? `${diff.selection.path} · ${diff.selection.lines.range.start}–${diff.selection.lines.range.end}`
            : (selectedPath ?? "Select a file or lines")}
        </span>
        {threadId &&
          (["Ask", "Explain", "Fix"] as const).map((action) => (
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
