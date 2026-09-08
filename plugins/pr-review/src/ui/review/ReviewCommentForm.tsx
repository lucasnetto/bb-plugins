import { Button } from "../components/ui/button";
import type { useReviewComposer } from "./useReviewComposer";

export function ReviewCommentForm({
  threadId,
  pullRequestNumber,
  hasDetail,
  hasSelection,
  loading,
  draft,
}: {
  threadId: string | null;
  pullRequestNumber: number | undefined;
  hasDetail: boolean;
  hasSelection: boolean;
  loading: boolean;
  draft: ReturnType<typeof useReviewComposer>;
}) {
  return (
    <form
      className="shrink-0 space-y-2 border-t border-border px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (hasSelection && draft.comment.trim() && !loading && !draft.addingComment)
          void draft.add("Comment");
      }}
    >
      <label
        className="block text-xs font-medium"
        htmlFor={`review-comment-${threadId}-${pullRequestNumber}`}
      >
        Comment on selected code
      </label>
      <textarea
        id={`review-comment-${threadId}-${pullRequestNumber}`}
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
          {hasSelection
            ? "Adds your comment and selected code to this chat."
            : "Select lines to attach this comment."}
        </span>
        <Button
          type="submit"
          size="sm"
          disabled={
            loading || draft.addingComment || !hasDetail || !hasSelection || !draft.comment.trim()
          }
        >
          Add to chat ⌘↵
        </Button>
      </div>
    </form>
  );
}
