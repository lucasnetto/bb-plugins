import { Schema } from "effect";

const id = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0));
const body = Schema.String.check(Schema.isMaxLength(65000));
const side = Schema.Literals(["LEFT", "RIGHT"]);
export const githubCommentSchema = Schema.Struct({
  id,
  node_id: Schema.String,
  body,
  path: Schema.String,
  outdated: Schema.Boolean,
  subjectType: Schema.Literals(["LINE", "FILE"]),
  line: Schema.NullOr(id),
  original_line: Schema.NullOr(id),
  side,
  start_line: Schema.optionalKey(Schema.NullOr(id)),
  user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  html_url: Schema.String,
  pull_request_review_id: id,
});
export const githubPendingSchema = Schema.Struct({
  id,
  node_id: Schema.String,
  body,
  commit_id: Schema.String,
  html_url: Schema.String,
});
export const githubReviewStateSchema = Schema.Struct({
  login: Schema.String,
  author: Schema.String,
  head: Schema.String,
  pending: Schema.NullOr(githubPendingSchema),
  comments: Schema.mutable(Schema.Array(githubCommentSchema)),
});
export type GithubReviewState = Schema.Schema.Type<typeof githubReviewStateSchema>;
export type GithubComment = Schema.Schema.Type<typeof githubCommentSchema>;
export const githubReviewTarget = Schema.Struct({
  url: Schema.String,
  threadId: Schema.NullOr(Schema.String),
});
const expected = { login: Schema.String, reviewId: Schema.NullOr(id) };
export const githubReviewAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("add"),
    ...expected,
    head: Schema.String,
    body,
    path: Schema.String,
    line: id,
    side,
    startLine: Schema.optionalKey(id),
    startSide: Schema.optionalKey(side),
  }),
  Schema.Struct({
    kind: Schema.Literal("edit"),
    ...expected,
    commentId: id,
    body,
    previousBody: body,
  }),
  Schema.Struct({ kind: Schema.Literal("remove"), ...expected, commentId: id, previousBody: body }),
  Schema.Struct({ kind: Schema.Literal("discard"), ...expected, fingerprint: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("submit"),
    head: Schema.String,
    ...expected,
    fingerprint: Schema.String,
    body,
    event: Schema.Literals(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  }),
]);
export type GithubReviewAction = Schema.Schema.Type<typeof githubReviewAction>;
export const githubReviewMutation = Schema.Struct({
  ...githubReviewTarget.fields,
  action: githubReviewAction,
});
// A snapshot check prevents submitting/discarding comments the user has not seen.
export function reviewFingerprint(state: GithubReviewState) {
  return JSON.stringify([
    state.head,
    state.pending,
    state.comments.filter((c) => c.pull_request_review_id === state.pending?.id),
  ]);
}
