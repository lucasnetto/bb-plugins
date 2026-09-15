import { useId, useState } from "react";
import type { GithubComment } from "../../shared/github-review-contract";
import type { GithubReview } from "./GithubReviewPanel";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { GithubReviewComment } from "./GithubReviewComment";
import { CommentAvatar } from "./CommentAvatar";

export function groupReviewComments(comments: readonly GithubComment[]) {
  const groups = new Map<string, GithubComment[]>();

  for (const comment of comments) {
    const group = groups.get(comment.threadId);

    if (group) group.push(comment);
    else groups.set(comment.threadId, [comment]);
  }

  return [...groups.values()].map((group) => group.sort((a, b) => a.id - b.id));
}

export function GithubReviewThread({
  comments,
  review,
  onReveal,
}: {
  comments: readonly GithubComment[];
  review: GithubReview;
  onReveal?: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const state = review.state;
  const thread = comments[0];

  if (!state || !thread) return null;
  const disabled = review.busy || !review.synced;
  const canResolve = thread.resolved ? thread.canUnresolve : thread.canResolve;

  return (
    <section
      aria-label={`Conversation on ${thread.path}`}
      className="min-w-0 overflow-hidden rounded-md border border-border bg-background font-sans text-sm"
    >
      <header className="flex items-center gap-2 bg-muted/30 px-3 text-xs">
        <button
          type="button"
          aria-label={`${collapsed ? "Expand" : "Collapse"} conversation on ${thread.path}`}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setCollapsed((value) => !value)}
        >
          <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} className="size-3.5 shrink-0" />
          <span className="truncate">
            {thread.subjectType === "FILE"
              ? "Comment on file"
              : `Comment on line ${thread.side === "RIGHT" ? "R" : "L"}${thread.line ?? thread.original_line}`}
          </span>
          {comments.length > 1 && <span className="shrink-0">· {comments.length} comments</span>}
          {thread.outdated && (
            <span className="ml-auto rounded-full border border-border px-2 text-muted-foreground">
              Outdated
            </span>
          )}
          {thread.resolved && (
            <span className="ml-auto rounded-full border border-border px-2 text-muted-foreground">
              Resolved
            </span>
          )}
        </button>
        {onReveal && (
          <button
            className="max-w-[50%] truncate font-mono text-muted-foreground hover:underline"
            onClick={() => onReveal(thread.path)}
          >
            {thread.path}
          </button>
        )}
      </header>
      {/* Keep editors mounted while collapsed so their unsaved text survives. */}
      <div id={contentId} hidden={collapsed} className="border-t border-border">
        <div className="py-1">
          {comments.map((comment) => (
            <GithubReviewComment
              key={`${state.login}:${comment.id}`}
              comment={comment}
              review={review}
            />
          ))}
        </div>
        {thread.canReply && (
          <div className="flex items-start gap-3 border-t border-border bg-muted/20 px-4 py-2">
            <CommentAvatar login={state.login} />
            <div className="min-w-0 flex-1">
              {replying ? (
                <div className="space-y-3">
                  <textarea
                    autoFocus
                    aria-label={`Reply on ${thread.path}`}
                    disabled={review.busy}
                    className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="mr-auto text-xs text-muted-foreground">
                      {state.pending
                        ? "Private until you submit your review."
                        : "Posts immediately to GitHub."}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={review.busy}
                      onClick={() => setReplying(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={disabled || !reply.trim()}
                      onClick={async () => {
                        if (
                          await review.mutate({
                            kind: "reply",
                            login: state.login,
                            reviewId: state.pending?.id ?? null,
                            threadId: thread.threadId,
                            body: reply,
                          })
                        ) {
                          setReply("");
                          setReplying(false);
                        }
                      }}
                    >
                      {state.pending ? "Add reply to review" : "Post reply"}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  aria-label="Reply"
                  className="w-full cursor-text rounded-md border border-input bg-background px-3 py-1.5 text-left text-sm text-muted-foreground hover:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => setReplying(true)}
                >
                  {reply || "Reply…"}
                </button>
              )}
            </div>
          </div>
        )}
        {canResolve && (
          <footer className="border-t border-border px-4 py-3">
            <Button
              size="sm"
              variant="outline"
              className="bg-muted/50"
              disabled={disabled}
              onClick={() =>
                void review.mutate({
                  kind: "resolve",
                  login: state.login,
                  reviewId: state.pending?.id ?? null,
                  threadId: thread.threadId,
                  resolved: !thread.resolved,
                  previousResolved: thread.resolved,
                })
              }
            >
              <Icon name={thread.resolved ? "RotateCcw" : "CircleCheck"} className="size-3.5" />
              {thread.resolved ? "Reopen conversation" : "Resolve conversation"}
            </Button>
          </footer>
        )}
      </div>
    </section>
  );
}
