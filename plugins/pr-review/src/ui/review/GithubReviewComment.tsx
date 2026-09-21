import { useState } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Button } from "../components/ui/button";
import { relativeTime } from "../workspace/presentation";
import { CommentAvatar } from "./CommentAvatar";
import { PrMenu, PrMenuItem } from "../workspace/Menu";
import type { GithubComment } from "../../shared/github-review-contract";
import type { GithubReview } from "./GithubReviewPanel";
import { ReviewCommentBody } from "./ReviewCommentBody";

export function GithubReviewComment({
  comment,
  review,
}: {
  comment: GithubComment;
  review: GithubReview;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [text, setText] = useState(comment.body);
  const [original, setOriginal] = useState(comment.body);
  const state = review.state;

  if (!state) return null;
  const pending = comment.pull_request_review_id === state.pending?.id;

  const expected = {
    login: state.login,
    reviewId: state.pending?.id ?? null,
    commentId: comment.id,
    previousBody: original,
  };

  return (
    <article className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-4 font-sans text-sm">
      <CommentAvatar login={comment.user?.login} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{comment.user?.login ?? "Ghost"}</span>
        <UrlLink
          href={comment.html_url}
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
            {relativeTime(comment.createdAt)}
          </time>
        </UrlLink>
        {pending && (
          <span className="rounded-full border border-border px-1.5 text-xs text-muted-foreground">
            Pending
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {comment.user?.login === state.author && (
            <span className="rounded-full border border-border px-1.5 text-xs text-muted-foreground">
              Author
            </span>
          )}
          {comment.user?.login === state.login && !editing && !deleting && (
            <div>
              <PrMenu
                label="Comment actions"
                icon="MoreHorizontal"
                compact
                disabled={review.busy || !review.synced}
              >
                <PrMenuItem
                  icon="Edit"
                  onSelect={() => {
                    setText(comment.body);
                    setOriginal(comment.body);
                    setEditing(true);
                  }}
                >
                  Edit comment
                </PrMenuItem>
                <PrMenuItem
                  icon="Trash2"
                  danger
                  onSelect={() => {
                    setOriginal(comment.body);
                    setDeleting(true);
                  }}
                >
                  Delete comment
                </PrMenuItem>
              </PrMenu>
            </div>
          )}
        </div>
      </div>
      <div className="col-start-2 min-w-0 space-y-3">
        {editing ? (
          <>
            <textarea
              aria-label={`Edit comment on ${comment.path}`}
              disabled={review.busy}
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {comment.body !== original && (
              <p role="alert">This comment changed on GitHub. Cancel to load the latest version.</p>
            )}
            <Button
              size="sm"
              disabled={review.busy || !review.synced || !text.trim() || comment.body !== original}
              onClick={async () => {
                if (await review.mutate({ kind: "edit", ...expected, body: text }))
                  setEditing(false);
              }}
            >
              Save comment
            </Button>{" "}
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <ReviewCommentBody content={comment.body} bodyHTML={comment.bodyHTML} />
        )}
        {deleting && (
          <div className="space-y-2" role="group" aria-label="Delete comment">
            <p>Delete this {pending ? "pending" : "published"} comment from GitHub?</p>
            <Button
              size="sm"
              variant="destructive"
              disabled={review.busy || !review.synced || comment.body !== original}
              onClick={async () => {
                if (await review.mutate({ kind: "remove", ...expected })) setDeleting(false);
              }}
            >
              Confirm delete
            </Button>{" "}
            <Button
              size="sm"
              variant="outline"
              disabled={review.busy}
              onClick={() => setDeleting(false)}
            >
              Cancel
            </Button>
            {comment.body !== original && (
              <p role="alert">This comment changed on GitHub. Cancel to load the latest version.</p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
