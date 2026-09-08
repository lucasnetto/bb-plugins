export type ReviewAction = "Ask" | "Explain" | "Fix" | "Comment";
type ReviewTarget = "this code" | "this file" | "this PR";

export function buildReviewDraftText(
  action: ReviewAction,
  target: ReviewTarget,
  comment: string,
): string {
  const trimmedComment = comment.trim();
  if (action === "Comment") return trimmedComment;
  const instruction = action === "Ask" ? "Review" : action;
  const commentSuffix = trimmedComment ? `\n${trimmedComment}` : "";
  return `${instruction} ${target}.${commentSuffix}`;
}
