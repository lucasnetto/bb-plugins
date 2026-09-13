import { Effect, Schema } from "effect";
import { command, decode, decodeSchema, invalid } from "./host-effects";
import { parsePrUrl } from "../shared/links-contract";
import {
  githubPendingSchema,
  reviewFingerprint,
  type GithubReviewAction,
} from "../shared/github-review-contract";

type ReviewThreadInput = Pick<
  Extract<GithubReviewAction, { kind: "add" }>,
  "body" | "path" | "line" | "side" | "startLine" | "startSide"
>;

type ReviewMutationInput =
  | (ReviewThreadInput & { pullRequestReviewId: string })
  | { pullRequestId: string; commitOID: string; threads: ReviewThreadInput[] }
  | { pullRequestReviewCommentId: string; body: string }
  | { id: string };

type ReviewGraphqlVariables =
  | { owner: string | undefined; name: string | undefined; number: number; after: string | null }
  | { id: string; after: string | null }
  | { input: ReviewMutationInput };

type ReviewApiPayload =
  | { query: string; variables: ReviewGraphqlVariables }
  | { event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"; body: string; commit_id?: string };

const api = Effect.fn("GithubReview.api")(function* (
  root: string,
  path: string,
  method = "GET",
  payload?: ReviewApiPayload,
  paginate = false,
) {
  return yield* command(
    root,
    "gh",
    [
      "api",
      "--hostname",
      "github.com",
      "--method",
      method,
      ...(paginate ? ["--paginate", "--slurp"] : []),
      ...(payload === undefined ? [] : ["--input", "-"]),
      path,
    ],
    payload === undefined ? undefined : JSON.stringify(payload),
  );
});

const user = Schema.Struct({ login: Schema.String });

const reviewSchema = Schema.Struct({
  ...githubPendingSchema.fields,
  state: Schema.String,
  user: Schema.NullOr(user),
});

const prSchema = Schema.Struct({
  node_id: Schema.String,
  head: Schema.Struct({ sha: Schema.String }),
  user,
});

const read = Effect.fn("GithubReview.read")(function* (root: string, url: string) {
  const ref = yield* decode(() => parsePrUrl(url));
  const path = `repos/${ref.repository}/pulls/${ref.number}`;

  const [viewer, pr, reviews] = yield* Effect.all(
    [
      api(root, "user").pipe(
        Effect.flatMap((raw) => decodeSchema(Schema.fromJsonString(user))(raw)),
      ),
      api(root, path).pipe(
        Effect.flatMap((raw) => decodeSchema(Schema.fromJsonString(prSchema))(raw)),
      ),
      api(root, `${path}/reviews?per_page=100`, "GET", undefined, true).pipe(
        Effect.flatMap((raw) =>
          decodeSchema(Schema.fromJsonString(Schema.Array(Schema.Array(reviewSchema))))(raw),
        ),
      ),
    ],
    { concurrency: 3 },
  );

  const pending =
    reviews.flat().find((r) => r.state === "PENDING" && r.user?.login === viewer.login) ?? null;

  return { ref, path, viewer, pr, pending };
});

const pageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});

const graphComment = Schema.Struct({
  databaseId: Schema.Number,
  id: Schema.String,
  body: Schema.String,
  url: Schema.String,
  author: Schema.NullOr(user),
  pullRequestReview: Schema.NullOr(Schema.Struct({ databaseId: Schema.Number })),
});

const graphComments = Schema.Struct({ nodes: Schema.Array(graphComment), pageInfo });

const graphThread = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  line: Schema.NullOr(Schema.Number),
  originalLine: Schema.NullOr(Schema.Number),
  diffSide: Schema.Literals(["LEFT", "RIGHT"]),
  startLine: Schema.NullOr(Schema.Number),
  isOutdated: Schema.Boolean,
  subjectType: Schema.Literals(["LINE", "FILE"]),
  comments: graphComments,
});

const commentFields =
  "nodes { databaseId id body url author { login } pullRequestReview { databaseId } } pageInfo { hasNextPage endCursor }";

const threadQuery = `query($owner:String!,$name:String!,$number:Int!,$after:String) {
  repository(owner:$owner,name:$name) { pullRequest(number:$number) {
    reviewThreads(first:100,after:$after) { nodes { id path line originalLine diffSide startLine isOutdated subjectType comments(first:100) { ${commentFields} } } pageInfo { hasNextPage endCursor } }
  } }
}`;

export const githubReview = Effect.fn("GithubReview.get")(function* (root: string, url: string) {
  const { ref, viewer, pr, pending } = yield* read(root, url);
  const [owner, name] = ref.repository.split("/");
  const comments = [];
  let after: string | null = null;

  do {
    const raw: string = yield* api(root, "graphql", "POST", {
      query: threadQuery,
      variables: { owner, name, number: ref.number, after },
    });

    const result = yield* decodeSchema(
      Schema.fromJsonString(
        Schema.Struct({
          data: Schema.Struct({
            repository: Schema.Struct({
              pullRequest: Schema.Struct({
                reviewThreads: Schema.Struct({ nodes: Schema.Array(graphThread), pageInfo }),
              }),
            }),
          }),
        }),
      ),
    )(raw);

    const page = result.data.repository.pullRequest.reviewThreads;

    for (const thread of page.nodes) {
      let commentPage = thread.comments;

      while (true) {
        for (const c of commentPage.nodes) {
          if (!c.pullRequestReview) continue;
          comments.push({
            id: c.databaseId,
            node_id: c.id,
            body: c.body,
            path: thread.path,
            outdated: thread.isOutdated,
            subjectType: thread.subjectType,
            line: thread.isOutdated ? null : thread.line,
            original_line: thread.originalLine,
            side: thread.diffSide,
            start_line: thread.startLine,
            user: c.author,
            html_url: c.url,
            pull_request_review_id: c.pullRequestReview.databaseId,
          });
        }

        if (!commentPage.pageInfo.hasNextPage) break;

        const rawComments = yield* api(root, "graphql", "POST", {
          query: `query($id:ID!,$after:String) { node(id:$id) { ... on PullRequestReviewThread { comments(first:100,after:$after) { ${commentFields} } } } }`,
          variables: { id: thread.id, after: commentPage.pageInfo.endCursor },
        });

        const more = yield* decodeSchema(
          Schema.fromJsonString(
            Schema.Struct({
              data: Schema.Struct({ node: Schema.Struct({ comments: graphComments }) }),
            }),
          ),
        )(rawComments);

        commentPage = more.data.node.comments;
      }
    }

    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  comments.sort((a, b) => a.id - b.id);

  return {
    login: viewer.login,
    author: pr.user.login,
    head: pr.head.sha,
    pending: pending
      ? {
          id: pending.id,
          node_id: pending.node_id,
          body: pending.body,
          commit_id: pending.commit_id,
          html_url: pending.html_url,
        }
      : null,
    comments,
  };
});

const graphql = Effect.fn("GithubReview.graphql")(function* (
  root: string,
  query: string,
  input: ReviewMutationInput,
) {
  const raw = yield* api(root, "graphql", "POST", { query, variables: { input } });

  const result = yield* decodeSchema(
    Schema.fromJsonString(
      Schema.Struct({
        errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
      }),
    ),
  )(raw);

  if (result.errors?.length) return yield* invalid(result.errors.map((e) => e.message).join("; "));
});

export const githubReviewMutate = Effect.fn("GithubReview.mutate")(function* (
  root: string,
  url: string,
  action: GithubReviewAction,
) {
  const state = yield* githubReview(root, url);
  const ref = yield* decode(() => parsePrUrl(url));
  const path = `repos/${ref.repository}/pulls/${ref.number}`;

  if (state.login !== action.login)
    return yield* invalid("GitHub account changed. Refresh before saving.");

  if ((state.pending?.id ?? null) !== action.reviewId)
    return yield* invalid("Your pending review changed on GitHub. Refresh and try again.");

  if (action.kind === "submit" && action.head !== state.head)
    return yield* invalid("New commits arrived. Refresh the diff before submitting your review.");
  const pending = state.pending;

  if (action.kind === "add") {
    if (action.head !== state.head)
      return yield* invalid("New commits arrived. Refresh the diff before adding to this review.");

    if (pending && pending.commit_id !== state.head)
      return yield* invalid(
        "This pending review belongs to an earlier commit. Finish it on GitHub or discard it before adding comments.",
      );

    if (!action.body.trim()) return yield* invalid("Write a comment first.");

    let thread: ReviewThreadInput = {
      body: action.body,
      path: action.path,
      line: action.line,
      side: action.side,
    };

    if (action.startLine !== undefined) {
      thread = { ...thread, startLine: action.startLine, startSide: action.startSide };
    }

    if (pending) {
      yield* graphql(
        root,
        "mutation($input:AddPullRequestReviewThreadInput!){addPullRequestReviewThread(input:$input){thread{id}}}",
        { ...thread, pullRequestReviewId: pending.node_id },
      );
    } else {
      const pr = yield* api(root, path).pipe(
        Effect.flatMap((raw) => decodeSchema(Schema.fromJsonString(prSchema))(raw)),
      );

      yield* graphql(
        root,
        "mutation($input:AddPullRequestReviewInput!){addPullRequestReview(input:$input){pullRequestReview{id}}}",
        { pullRequestId: pr.node_id, commitOID: action.head, threads: [thread] },
      );
    }
  } else {
    if (action.kind === "submit" && !pending) {
      if (reviewFingerprint(state) !== action.fingerprint)
        return yield* invalid("Your review changed on GitHub. Refresh before submitting.");

      if (action.event !== "COMMENT" && state.login === state.author)
        return yield* invalid(
          "GitHub does not allow approving or requesting changes on your own PR.",
        );

      if (action.event !== "APPROVE" && !action.body.trim())
        return yield* invalid("Write a review summary first.");
      yield* api(root, `${path}/reviews`, "POST", {
        event: action.event,
        body: action.body,
        commit_id: state.head,
      });

      return { url: ref.url };
    }

    if (!pending)
      return yield* invalid("There is no pending review. Refresh to see its current state.");

    if (action.kind === "edit" || action.kind === "remove") {
      const comment = state.comments.find(
        (c) =>
          c.id === action.commentId &&
          c.pull_request_review_id === pending.id &&
          c.user?.login === state.login,
      );

      if (!comment || comment.body !== action.previousBody)
        return yield* invalid("This draft comment changed on GitHub. Reload it before editing.");

      if (action.kind === "edit" && !action.body.trim())
        return yield* invalid("Write a comment first.");

      if (action.kind === "edit")
        yield* graphql(
          root,
          "mutation($input:UpdatePullRequestReviewCommentInput!){updatePullRequestReviewComment(input:$input){pullRequestReviewComment{id}}}",
          { pullRequestReviewCommentId: comment.node_id, body: action.body },
        );
      else
        yield* graphql(
          root,
          "mutation($input:DeletePullRequestReviewCommentInput!){deletePullRequestReviewComment(input:$input){clientMutationId}}",
          { id: comment.node_id },
        );
    } else {
      if (reviewFingerprint(state) !== action.fingerprint)
        return yield* invalid(
          "Your review changed on GitHub. Refresh and review all comments before continuing.",
        );

      if (action.kind === "discard") yield* api(root, `${path}/reviews/${pending.id}`, "DELETE");
      else {
        if (action.event !== "COMMENT" && state.login === state.author)
          return yield* invalid(
            "GitHub does not allow approving or requesting changes on your own PR.",
          );
        yield* api(root, `${path}/reviews/${pending.id}/events`, "POST", {
          event: action.event,
          body: action.body,
        });
      }
    }
  }

  // A completed write returns a receipt. A failed subsequent refresh must never masquerade as a failed write.
  return { url: pending?.html_url ?? `${ref.url}/files` };
});
