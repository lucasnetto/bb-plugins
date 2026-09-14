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

function fixture(pending = true) {
  const writes: { route: string; payload: unknown; args: string[] }[] = [];

  const run: Command = async (_root, _program, args, _signal, stdin) => {
    const route = args.at(-1)!;

    if (route === "graphql" && stdin && JSON.parse(stdin).query.startsWith("query")) {
      return JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: pending
                  ? [
                      {
                        id: "T1",
                        path: comment.path,
                        line: comment.line,
                        originalLine: comment.original_line,
                        diffSide: comment.side,
                        startLine: null,
                        isOutdated: false,
                        subjectType: "LINE",
                        comments: {
                          nodes: [
                            {
                              databaseId: comment.id,
                              id: comment.node_id,
                              body: comment.body,
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
