import { Button } from "../components/ui/button";
import { GuideGenerator } from "./GuideGenerator";
import { GuidedReview } from "./GuidedReview";
import type { useGuide } from "./useGuide";
import type { ReviewAnnotationRenderer, ReviewSelection, useReviewDiff } from "./useReviewDiff";

export function ReviewGuidePanel({
  threadId,
  guideRequestOpen,
  setGuideRequestOpen,
  guide,
  diff,
  staleGuide,
  loading,
  hasChangedFiles,
  selectedPath,
  setSelectedPath,
  onSelection,
  annotation,
}: {
  threadId: string;
  guideRequestOpen: boolean;
  setGuideRequestOpen: (open: boolean) => void;
  guide: ReturnType<typeof useGuide>;
  diff: Pick<ReturnType<typeof useReviewDiff>, "viewer" | "selection">;
  staleGuide: boolean;
  loading: boolean;
  hasChangedFiles: boolean;
  selectedPath: string | null;
  setSelectedPath: (path: string | null) => void;
  onSelection: (selection: ReviewSelection | null | undefined) => void;
  annotation: ReviewAnnotationRenderer;
}) {
  return (
    <>
      <GuideGenerator
        threadId={threadId}
        open={guideRequestOpen}
        onOpenChange={setGuideRequestOpen}
        pending={guide.mutationPending}
        onStart={async (model) => {
          if (await guide.generation.start(model)) setGuideRequestOpen(false);
        }}
      />
      {guide.error || guide.generation.error ? (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {guide.error || guide.generation.error}
        </p>
      ) : null}
      {guide.generation.generating ? (
        <p role="status" className="px-4 py-2 text-sm text-muted-foreground">
          Generating review guide…{" "}
          <Button
            size="sm"
            variant="outline"
            disabled={guide.mutationPending}
            onClick={() => void guide.generation.cancel()}
          >
            Cancel generation
          </Button>
        </p>
      ) : null}
      {guide.data ? (
        <GuidedReview
          saved={guide.data}
          items={diff.viewer.items}
          stale={staleGuide || loading}
          pending={guide.mutationPending || guide.generation.generating || guide.loading || loading}
          onRequest={() => setGuideRequestOpen(true)}
          onMark={(index, reviewed) => void guide.mark(index, reviewed)}
          selectedPath={selectedPath}
          onSelectPath={setSelectedPath}
          options={diff.viewer.options}
          selection={diff.selection.lines}
          onSelection={onSelection}
          header={diff.viewer.header}
          annotation={annotation}
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
              guide.mutationPending ||
              guide.generation.generating ||
              !hasChangedFiles
            }
            onClick={() => setGuideRequestOpen(true)}
          >
            {guide.generation.starting
              ? "Starting…"
              : staleGuide
                ? "Regenerate guide"
                : "Generate guide"}
          </Button>
          <p className="text-xs text-muted-foreground">Choose a model before generating.</p>
        </div>
      )}
    </>
  );
}
