import { expect, test } from "vite-plus/test";
import { githubReview, githubReviewMutate } from "../../src/server/github-review-host";
import { runHost, type Command } from "../../src/server/host-effects";
import { reviewFingerprint } from "../../src/shared/github-review-contract";

const url = "https://github.com/org/api/pull/9";

const head = "a".repeat(40);

const comment = {
  id: 20,
  node_id: "C20",
  body: "draft",
  path: "a.ts",
  line: 4,
  original_line: 4,
  side: "RIGHT",
  user: { login: "reviewer" },
  html_url: url,
  pull_request_review_id: 10,
};

const review = {
  id: 10,
  node_id: "R10",
  state: "PENDING",
  body: "summary",
  user: { login: "reviewer" },
  commit_id: head,
  html_url: url,
};

function fixture(pending = true, published = false) {
  const writes: { route: string; payload: unknown; args: string[] }[] = [];

  const run: Command = async (_root, _program, args, _signal, stdin) => {
    const route = args.at(-1)!;

    if (route === "graphql" && stdin && JSON.parse(stdin).query.startsWith("query")) {
      return JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes:
                  pending || published
                    ? [
                        {
                          id: "T1",
                          path: comment.path,
                          line: comment.line,
                          originalLine: comment.original_line,
                          diffSide: comment.side,
                          startLine: null,
                          isOutdated: false,
                          isResolved: false,
                          viewerCanReply: true,
                          viewerCanResolve: true,
                          viewerCanUnresolve: false,
                          subjectType: "LINE",
                          comments: {
                            nodes: [
                              {
                                databaseId: comment.id,
                                createdAt: "2026-09-15T18:00:00Z",
                                id: comment.node_id,
                                body: comment.body,
                                bodyHTML: "<p>draft</p>",
                                url,
                                author: comment.user,
                                pullRequestReview: { databaseId: review.id },
                              },
                            ],
                            pageInfo: { hasNextPage: false, endCursor: null },
                          },
                        },
                      ]
                    : [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      });
    }

    if (args[args.indexOf("--method") + 1] !== "GET") {
      writes.push({ route, args, payload: stdin ? JSON.parse(stdin) : null });

      return route === "graphql" ? '{"data":{}}' : "{}";
    }

    if (route === "user") return JSON.stringify({ login: "reviewer" });

    if (route.endsWith("/pulls/9"))
      return JSON.stringify({ node_id: "PR9", head: { sha: head }, user: { login: "author" } });

    if (route.includes("/reviews?")) {
      expect(args).not.toContain("--slurp");
      expect(args).toContain("--paginate");
      expect(args[args.indexOf("--jq") + 1]).toBe("@json");

      return `${JSON.stringify([{ ...review, state: "COMMENTED" }])}\n${JSON.stringify(pending ? [review] : [])}\n`;
    }

    if (route.includes("/comments?")) return JSON.stringify(pending ? [[comment]] : [[]]);
    throw new Error(`Unexpected route ${route}`);
  };

  return { run, writes };
}

test("reads and deduplicates pending comments from GitHub", async () => {
  const f = fixture();
  const state = await runHost(githubReview("/repo", url), undefined, f.run);
  expect(state.pending?.id).toBe(10);
  expect(state.comments).toHaveLength(1);
  expect(state.login).toBe("reviewer");
  expect(f.writes).toHaveLength(0);
});

test("creates a pending review with its first multiline comment in one request, over stdin", async () => {
  const f = fixture(false);
  await runHost(
    githubReviewMutate("/repo", url, {
      kind: "add",
      login: "reviewer",
      reviewId: null,
      head,
      path: "a.ts",
      body: "private text",
      side: "RIGHT",
      line: 4,
      startLine: 2,
      startSide: "RIGHT",
    }),
    undefined,
    f.run,
  );
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].args.join(" ")).not.toContain("private text");
  expect(f.writes[0].payload).toMatchObject({
    variables: {
      input: {
        pullRequestId: "PR9",
        commitOID: head,
        threads: [{ body: "private text", line: 4, startLine: 2 }],
      },
    },
  });
  expect(JSON.stringify(f.writes[0].payload)).not.toContain('"event"');
});

test("adds to the existing review and preserves GitHub's review identity", async () => {
  const f = fixture();
  await runHost(
    githubReviewMutate("/repo", url, {
      kind: "add",
      login: "reviewer",
      reviewId: 10,
      head,
      path: "a.ts",
      body: "next",
      side: "LEFT",
      line: 4,
    }),
    undefined,
    f.run,
  );
  expect(f.writes[0].payload).toMatchObject({
    variables: { input: { pullRequestReviewId: "R10", side: "LEFT" } },
  });
});

test("rejects wrong accounts, stale heads, reviews changed elsewhere, and unrelated comments before writing", async () => {
  const actions = [
    { kind: "remove", login: "other", reviewId: 10, commentId: 20, previousBody: "draft" },
    { kind: "remove", login: "reviewer", reviewId: 11, commentId: 20, previousBody: "draft" },
    { kind: "remove", login: "reviewer", reviewId: 10, commentId: 99, previousBody: "draft" },
    {
      kind: "edit",
      login: "reviewer",
      reviewId: 10,
      commentId: 20,
      previousBody: "old text",
      body: "new",
    },
    {
      kind: "add",
      login: "reviewer",
      reviewId: 10,
      head: "b".repeat(40),
      path: "a.ts",
      body: "next",
      side: "LEFT",
      line: 4,
    },
    {
      kind: "submit",
      head,
      login: "reviewer",
      reviewId: 10,
      fingerprint: "stale",
      body: "summary",
      event: "COMMENT",
    },
  ] as const;

  for (const action of actions) {
    const f = fixture();
    await expect(
      runHost(githubReviewMutate("/repo", url, action), undefined, f.run),
    ).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test("submits the entire observed GitHub draft, and returns success independently of refresh", async () => {
  const f = fixture();
  const state = await runHost(githubReview("/repo", url), undefined, f.run);

  const receipt = await runHost(
    githubReviewMutate("/repo", url, {
      kind: "submit",
      head,
      login: "reviewer",
      reviewId: 10,
      fingerprint: reviewFingerprint(state),
      body: "summary",
      event: "COMMENT",
    }),
    undefined,
    f.run,
  );

  expect(receipt.url).toBe(url);
  expect(f.writes).toEqual([
    expect.objectContaining({
      route: "repos/org/api/pulls/9/reviews/10/events",
      payload: { event: "COMMENT", body: "summary" },
    }),
  ]);
});

test("does not retry ambiguous write failures", async () => {
  const f = fixture();
  let attempts = 0;

  const run: Command = (...args) => {
    if (args[4]?.includes("UpdatePullRequestReviewCommentInput")) {
      attempts++;

      return Promise.reject(new Error("connection reset"));
    }

    return f.run(...args);
  };

  await expect(
    runHost(
      githubReviewMutate("/repo", url, {
        kind: "edit",
        login: "reviewer",
        reviewId: 10,
        commentId: 20,
        previousBody: "draft",
        body: "new",
      }),
      undefined,
      run,
    ),
  ).rejects.toThrow("connection reset");
  expect(attempts).toBe(1);
});

test("rejects a submit against a newer head even if its refreshed review snapshot matches", async () => {
  const f = fixture();
  const state = await runHost(githubReview("/repo", url), undefined, f.run);
  await expect(
    runHost(
      githubReviewMutate("/repo", url, {
        kind: "submit",
        login: "reviewer",
        reviewId: 10,
        head: "old",
        fingerprint: reviewFingerprint(state),
        body: "summary",
        event: "APPROVE",
      }),
      undefined,
      f.run,
    ),
  ).rejects.toThrow("New commits arrived");
  expect(f.writes).toHaveLength(0);
});

test("edits and deletes own published comments without a pending review", async () => {
  for (const kind of ["edit", "remove"] as const) {
    const f = fixture(false, true);
    await runHost(
      githubReviewMutate("/repo", url, {
        kind,
        login: "reviewer",
        reviewId: null,
        commentId: 20,
        previousBody: "draft",
        body: "updated",
      }),
      undefined,
      f.run,
    );
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].payload).toMatchObject({
      variables: {
        input:
          kind === "edit" ? { pullRequestReviewCommentId: "C20", body: "updated" } : { id: "C20" },
      },
    });
  }
});

test("replies to the GitHub thread and joins only an existing pending review", async () => {
  for (const pending of [true, false]) {
    const f = fixture(pending, true);
    await runHost(
      githubReviewMutate("/repo", url, {
        kind: "reply",
        login: "reviewer",
        reviewId: pending ? 10 : null,
        threadId: "T1",
        body: "reply",
      }),
      undefined,
      f.run,
    );
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].payload).toEqual({
      query: expect.stringContaining("addPullRequestReviewThreadReply"),
      variables: {
        input: {
          pullRequestReviewThreadId: "T1",
          body: "reply",
          pullRequestReviewId: pending ? "R10" : undefined,
        },
      },
    });
  }
});

function changeThread(
  run: Command,
  overrides: Partial<{
    isResolved: boolean;
    viewerCanReply: boolean;
    viewerCanResolve: boolean;
    viewerCanUnresolve: boolean;
  }>,
): Command {
  return async (...args) => {
    const raw = await run(...args);

    if (args[4]?.includes("reviewThreads(first:")) {
      const parsed = JSON.parse(raw);
      Object.assign(parsed.data.repository.pullRequest.reviewThreads.nodes[0], overrides);

      return JSON.stringify(parsed);
    }

    return raw;
  };
}

test("resolves and reopens threads with GitHub permissions and observed state", async () => {
  for (const resolved of [true, false]) {
    const f = fixture(false, true);
    await runHost(
      githubReviewMutate("/repo", url, {
        kind: "resolve",
        login: "reviewer",
        reviewId: null,
        threadId: "T1",
        resolved,
        previousResolved: !resolved,
      }),
      undefined,
      changeThread(f.run, {
        isResolved: !resolved,
        viewerCanResolve: resolved,
        viewerCanUnresolve: !resolved,
      }),
    );
    expect(f.writes[0].payload).toEqual({
      query: expect.stringContaining(
        resolved ? "{resolveReviewThread(" : "{unresolveReviewThread(",
      ),
      variables: { input: { threadId: "T1" } },
    });
  }
});

test("rejects stale, unrelated, blank and unauthorized comment actions before writing", async () => {
  const actions = [
    { kind: "reply", threadId: "missing", body: "reply" },
    { kind: "reply", threadId: "T1", body: " " },
    { kind: "reply", threadId: "T1", body: "reply" },
    { kind: "resolve", threadId: "T1", resolved: true, previousResolved: true },
    { kind: "resolve", threadId: "T1", resolved: true, previousResolved: false },
    { kind: "edit", commentId: 20, previousBody: "draft", body: "changed" },
    { kind: "remove", commentId: 20, previousBody: "draft" },
  ] as const;

  for (const action of actions) {
    const f = fixture(false, true);

    const run: Command = async (...args) => {
      const raw = await changeThread(f.run, { viewerCanReply: false, viewerCanResolve: false })(
        ...args,
      );

      if (args[4]?.includes("reviewThreads(first:")) {
        const parsed = JSON.parse(raw);
        parsed.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].author.login =
          "someone-else";

        return JSON.stringify(parsed);
      }

      return raw;
    };

    await expect(
      runHost(
        githubReviewMutate("/repo", url, { ...action, login: "reviewer", reviewId: null }),
        undefined,
        run,
      ),
    ).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test("rendered image URL refreshes preserve the pending review fingerprint", async () => {
  const { run } = fixture();
  const state = await runHost(githubReview("/repo", url), undefined, run);
  expect(state.comments[0]?.bodyHTML).toBe("<p>draft</p>");
  const refreshed = {
    ...state,
    comments: state.comments.map((entry) => ({
      ...entry,
      bodyHTML: '<img src="https://example.com/refreshed.png">',
    })),
  };
  expect(reviewFingerprint(refreshed)).toBe(reviewFingerprint(state));
  const edited = {
    ...state,
    comments: state.comments.map((entry) => ({ ...entry, body: "edited" })),
  };
  expect(reviewFingerprint(edited)).not.toBe(reviewFingerprint(state));
});
