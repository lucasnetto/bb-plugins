import { Button } from "../components/ui/button";
import type { useReviewComposer } from "./useReviewComposer";

export function ReviewCommentForm({
  threadId,
  pullRequestNumber,
  hasDetail,
  loading,
  draft,
  githubDisabled,
  onAddToReview,
  onClose,
}: {
  githubDisabled?: boolean;
  onAddToReview?: () => Promise<void>;
  onClose: () => void;
  threadId: string | null;
  pullRequestNumber: number | undefined;
  hasDetail: boolean;
  loading: boolean;
  draft: ReturnType<typeof useReviewComposer>;
}) {
  return (
    <form
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-background p-3"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();

        if (!draft.comment.trim() || loading || draft.addingComment) return;

        if (threadId) {
          void draft.add("Comment").then((added) => {
            if (added) onClose();
          });
        } else if (!githubDisabled && hasDetail) void onAddToReview?.();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          className="text-xs font-medium"
          htmlFor={`review-comment-${threadId}-${pullRequestNumber}`}
        >
          Comment on selected code
        </label>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close comment
        </Button>
      </div>
      <textarea
        id={`review-comment-${threadId}-${pullRequestNumber}`}
        rows={3}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder="Write a comment about this code…"
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-full text-xs text-muted-foreground">
          {threadId
            ? "Save a GitHub draft or add this code and comment to your chat."
            : "Save a draft comment to your GitHub review."}
        </span>
        {onAddToReview && (
          <Button
            type="button"
            size="sm"
            disabled={loading || githubDisabled || !hasDetail || !draft.comment.trim()}
            onClick={() => void onAddToReview()}
          >
            Add to review
          </Button>
        )}
        {threadId && (
          <Button
            type="submit"
            size="sm"
            disabled={loading || draft.addingComment || !hasDetail || !draft.comment.trim()}
          >
            Add to chat ⌘↵
          </Button>
        )}
      </div>
    </form>
  );
}
