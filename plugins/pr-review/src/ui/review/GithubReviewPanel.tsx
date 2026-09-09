import { useState } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Button } from "../components/ui/button";
import { reviewFingerprint, type GithubComment } from "../../shared/github-review-contract";
import type { useGithubReview } from "./useGithubReview";
import { ReviewCommentBody } from "./ReviewCommentBody";
export type GithubReview = ReturnType<typeof useGithubReview>;

function DraftComment({
  comment,
  review,
  onReveal,
}: {
  comment: GithubComment;
  review: GithubReview;
  head?: string;
  onReveal: (path: string) => void;
}) {
  const [editing, setEditing] = useState(false);
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
    <article className="space-y-2 rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="break-all text-left font-mono underline underline-offset-2"
          onClick={() => onReveal(comment.path)}
        >
          {comment.path}
          {comment.subjectType === "FILE" ? "" : `:${comment.line ?? comment.original_line}`}
        </button>
        <span className="text-muted-foreground">
          {comment.user?.login} · {pending ? "Pending" : "Published"}
          {comment.outdated ? " · Outdated" : ""}
        </span>
        {!pending && <UrlLink href={comment.html_url}>GitHub ↗</UrlLink>}
      </div>
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
              if (await review.mutate({ kind: "edit", ...expected, body: text })) setEditing(false);
            }}
          >
            Save comment
          </Button>{" "}
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <ReviewCommentBody content={comment.body} />
      )}
      {pending && !editing && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={review.busy || !review.synced}
            onClick={() => {
              setText(comment.body);
              setOriginal(comment.body);
              setEditing(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={review.busy || !review.synced}
            onClick={() =>
              void review.mutate({ kind: "remove", ...expected, previousBody: comment.body })
            }
          >
            Remove
          </Button>
        </div>
      )}
    </article>
  );
}
function ReviewBody({
  head,
  review,
  onReveal,
}: {
  review: GithubReview;
  head?: string;
  onReveal: (path: string) => void;
}) {
  const state = review.state;
  const remoteBody = state?.pending?.body ?? "";
  const [edit, setEdit] = useState<{ body: string; original: string } | null>(null);
  const [discard, setDiscard] = useState(false);
  if (!state) return null;
  const body = edit?.body ?? remoteBody;
  const conflict = edit !== null && edit.original !== remoteBody;
  const expected = { login: state.login, reviewId: state.pending?.id ?? null };
  const disabled = review.busy || !review.synced;
  const stale = !head || head !== state.head;
  const pending = state.comments.filter((c) => c.pull_request_review_id === state.pending?.id);
  return (
    <div className="space-y-3 px-3 pb-3">
      <p className="text-xs text-muted-foreground">
        Reviewing as {state.login}. Line comments are saved to GitHub and private until you submit,
        including comments added on GitHub. The summary is sent when you submit.
      </p>
      {stale && (
        <p className="text-xs text-muted-foreground">
          Refresh the diff to review the latest commits before submitting.
        </p>
      )}
      <label className="block space-y-1 text-xs font-medium">
        Review summary
        <textarea
          className="w-full rounded-md border border-input bg-background p-2 text-sm"
          rows={3}
          placeholder="Summarize your review (optional)"
          disabled={review.busy}
          value={body}
          onChange={(e) =>
            setEdit({ body: e.target.value, original: edit?.original ?? remoteBody })
          }
        />
      </label>
      {conflict && (
        <p role="alert" className="text-xs text-destructive">
          The summary changed on GitHub. Keep a copy of your text, then load the latest summary.
        </p>
      )}
      {edit && (
        <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
          Reset summary
        </Button>
      )}
      {
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={disabled || conflict || stale || (!body.trim() && pending.length === 0)}
            onClick={async () => {
              if (
                await review.mutate({
                  kind: "submit",
                  ...expected,
                  fingerprint: reviewFingerprint(state),
                  head: head ?? "",
                  body,
                  event: "COMMENT",
                })
              )
                setEdit(null);
            }}
          >
            Submit review to GitHub
          </Button>
          {state.login !== state.author && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || conflict || stale}
                onClick={async () => {
                  if (
                    await review.mutate({
                      kind: "submit",
                      ...expected,
                      fingerprint: reviewFingerprint(state),
                      head: head ?? "",
                      body,
                      event: "APPROVE",
                    })
                  )
                    setEdit(null);
                }}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || conflict || stale || !body.trim()}
                onClick={async () => {
                  if (
                    await review.mutate({
                      kind: "submit",
                      ...expected,
                      fingerprint: reviewFingerprint(state),
                      head: head ?? "",
                      body,
                      event: "REQUEST_CHANGES",
                    })
                  )
                    setEdit(null);
                }}
              >
                Request changes
              </Button>
            </>
          )}
          {state.pending && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setDiscard(!discard)}
            >
              Discard review
            </Button>
          )}
          {discard && (
            <div className="w-full rounded-md border border-border p-2 text-xs">
              Delete this pending review and all {pending.length} comments, including those added on
              GitHub?
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={async () => {
                    if (
                      await review.mutate({
                        kind: "discard",
                        ...expected,
                        fingerprint: reviewFingerprint(state),
                      })
                    ) {
                      setDiscard(false);
                      setEdit(null);
                    }
                  }}
                >
                  Confirm discard
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDiscard(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      }
      {state.comments.length ? (
        <div className="space-y-2">
          {[
            ...pending,
            ...state.comments.filter((c) => c.pull_request_review_id !== state.pending?.id),
          ].map((comment) => (
            <DraftComment key={comment.id} comment={comment} review={review} onReveal={onReveal} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Select lines to add a review comment.</p>
      )}
    </div>
  );
}
export function GithubReviewPanel({
  head,
  review,
  onReveal,
}: {
  review: GithubReview;
  head?: string;
  onReveal: (path: string) => void;
}) {
  const count =
    review.state?.comments.filter((c) => c.pull_request_review_id === review.state?.pending?.id)
      .length ?? 0;
  return (
    <section
      aria-label="GitHub review"
      className="max-h-[45%] shrink-0 overflow-auto border-t border-border"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          aria-expanded={review.open}
          onClick={() => review.setOpen(!review.open)}
        >
          GitHub review{count ? ` · ${count} pending` : ""}
        </Button>
        {review.publishedUrl && (
          <UrlLink href={review.publishedUrl}>View submitted review ↗</UrlLink>
        )}
        <span role="status" className="text-xs text-muted-foreground">
          {review.notice || (!review.state && !review.error ? "Connecting to GitHub…" : "")}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={review.busy}
          onClick={() => void review.refresh()}
        >
          Refresh review
        </Button>
      </div>
      {review.error && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {review.error}
        </p>
      )}
      {/* Keep unsaved editor text when this section is collapsed. GitHub owns saved drafts. */}
      <div hidden={!review.open}>
        <ReviewBody key={review.state?.login} review={review} head={head} onReveal={onReveal} />
      </div>
    </section>
  );
}
