import { expect, it } from "vite-plus/test";
import { prAction, prMergeStatus, stackScope } from "../../src/server/workspace-actions";
import {
  ACTION_PREFLIGHT_QUERY,
  OVERVIEW_QUERY,
  checkState,
  prOverview,
  prStack,
  prTimeline,
} from "../../src/server/workspace-github";
import { runHost, type Command } from "../../src/server/host-effects";
import { overview, rawOverview, stack } from "../workspace-fixture";
import type { Overview, WorkspaceAction } from "../../src/shared/workspace-contract";

it("PR overview carries the actual merge and close timestamps", async () => {
  const timestamp = "2026-09-15T12:00:00Z";

  const result = await runHost(
    prOverview("/repo", overview.url),
    undefined,
    async (_root, program, _args, _signal, body) => {
      if (program === "git") return "https://github.com/other/repo.git";
      expect(JSON.parse(body ?? "{}").query).toBe(OVERVIEW_QUERY);
      expect(OVERVIEW_QUERY).toContain("mergedAt closedAt");

      return JSON.stringify(
        rawOverview({ state: "MERGED", mergedAt: timestamp, closedAt: timestamp }),
      );
    },
  );

  expect(result.mergedAt).toBe(timestamp);
  expect(result.closedAt).toBe(timestamp);
});

const expected = {
  number: stack.number,
  base: stack.base,
  heads: stack.layers.map(({ number, headRefOid }) => ({ number, headRefOid: headRefOid! })),
};

const rawStack = [
  {
    number: 7,
    base: "main",
    pull_requests: stack.layers.map((layer) => ({
      number: layer.number,
      title: layer.title,
      draft: layer.isDraft,
      head: { ref: layer.headRefName, sha: layer.headRefOid },
      state: "open",
      merged_at: null,
    })),
  },
];

function fixture(
  options: {
    pr?: Partial<Overview>;
    stack?: unknown;
    stackError?: string;
    status?: unknown;
    dirty?: boolean;
  } = {},
) {
  const writes: { args: string[]; body?: string }[] = [];

  const run: Command = async (_root, program, args, _signal, body) => {
    if (program === "git") {
      if (args.includes("remote")) return "https://github.com/acme/api.git";

      if (args.includes("rev-parse")) return "/checkout";

      if (args.includes("status")) return options.dirty ? " M file.ts" : "";
    }

    const payload = body ? JSON.parse(body.startsWith("{") ? body : "{}") : {};

    if (args.includes("graphql") && payload.query === ACTION_PREFLIGHT_QUERY)
      return JSON.stringify(rawOverview(options.pr));

    if (args.some((arg) => arg.includes("/stacks?"))) {
      if (options.stackError) throw new Error(options.stackError);

      return JSON.stringify(options.stack ?? []);
    }

    writes.push({ args, body });

    if (payload.query?.includes("result:"))
      return JSON.stringify({ data: { result: { pullRequest: { id: overview.id } } } });

    if (args.includes("graphql"))
      return JSON.stringify({
        data: { updatePullRequestBranch: { pullRequest: { headRefOid: "d".repeat(40) } } },
      });

    return JSON.stringify(options.status ?? { status: "pending", details: { uuid: "merge-job" } });
  };

  const action = (action: WorkspaceAction, head = overview.headRefOid) =>
    runHost(prAction("/checkout", overview.url, head, "main", action), undefined, run);

  return { writes, run, action };
}

it("normal merges match the reviewed SHA and let GitHub enforce merge policy", async () => {
  const f = fixture();
  await f.action({ kind: "merge", method: "squash", auto: false, stack: null });
  expect(f.writes).toEqual([
    {
      args: ["pr", "merge", overview.url, "--squash", "--match-head-commit", overview.headRefOid],
      body: undefined,
    },
  ]);
});

it("native stack merge submits one atomic operation for the confirmed scope and tracks its status", async () => {
  const f = fixture({ stack: rawStack });
  expect(
    await f.action({ kind: "merge", method: "merge", auto: false, stack: expected }),
  ).toMatchObject({ pendingMergeId: "merge-job" });
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]?.args).toContain("repos/acme/api/pulls/42/merge-async");
  expect(JSON.parse(f.writes[0]!.body!)).toEqual({
    sha: overview.headRefOid,
    merge_method: "merge",
    merge_action: "default",
  });

  const status = await runHost(
    prMergeStatus("/checkout", overview.url, "merge-job"),
    undefined,
    f.run,
  );

  expect(status.status).toBe("pending");
  expect(f.writes[1]?.args).toContain("repos/acme/api/pulls/42/merge-async/merge-job");
});

it("rejects changed heads, stack membership and lower layer revisions before writing", async () => {
  const f = fixture({ stack: rawStack });
  await expect(
    f.action({ kind: "merge", method: "merge", auto: false, stack: expected }, "e".repeat(40)),
  ).rejects.toThrow("changed");
  await expect(
    f.action({ kind: "merge", method: "merge", auto: false, stack: null }),
  ).rejects.toThrow("stack changed");
  await expect(
    f.action({
      kind: "merge",
      method: "merge",
      auto: false,
      stack: { ...expected, heads: expected.heads.slice(1) },
    }),
  ).rejects.toThrow("stack changed");
  expect(f.writes).toEqual([]);
  expect(() => stackScope({ ...stack, base: "other" }, expected, 42, false)).toThrow("changed");
  expect(() => stackScope(stack, expected, 41, true)).toThrow("changed");
});

it("a stack authorization failure never falls back to ordinary merging", async () => {
  const f = fixture({ stackError: "HTTP 403 forbidden" });
  await expect(
    f.action({ kind: "merge", method: "squash", auto: false, stack: null }),
  ).rejects.toThrow("403");
  expect(f.writes).toEqual([]);
  expect(
    await runHost(
      prStack("/checkout", overview.url),
      undefined,
      fixture({ stackError: "HTTP 404 Not Found" }).run,
    ),
  ).toBeNull();
});

it("requires every stack layer to be ready and rejects GitHub merge failures", async () => {
  const f = fixture({
    stack: [
      {
        ...rawStack[0],
        pull_requests: rawStack[0]!.pull_requests.map((pr) => ({ ...pr, draft: pr.number === 41 })),
      },
    ],
  });

  await expect(
    f.action({ kind: "merge", method: "squash", auto: false, stack: expected }),
  ).rejects.toThrow("ready");
  expect(f.writes).toEqual([]);

  const failed = fixture({
    stack: rawStack,
    status: { status: "failed", details: { message: "Checks failed" } },
  });

  await expect(
    failed.action({ kind: "merge", method: "squash", auto: false, stack: expected }),
  ).rejects.toThrow("Checks failed");
});

it("branch rebases guard the expected head and description edits reject stale versions", async () => {
  const f = fixture();
  await f.action({ kind: "update-branch", method: "rebase", stack: null });
  expect(JSON.parse(f.writes[0]!.body!).variables).toEqual({
    id: overview.id,
    head: overview.headRefOid,
    method: "REBASE",
  });
  await expect(
    f.action({ kind: "edit", title: "changed", body: "", updatedAt: "older" }),
  ).rejects.toThrow("description changed");
  expect(f.writes).toHaveLength(1);
});

it("passes comment text through stdin and refuses to check out over local changes", async () => {
  const f = fixture({ dirty: true });
  const body = "A comment with `code` and $(literal text)\n\nSecond paragraph.";
  await f.action({ kind: "comment", body });
  expect(f.writes[0]?.args).toContain("repos/acme/api/issues/42/comments");
  expect(JSON.parse(f.writes[0]!.body!)).toEqual({ body });
  await expect(f.action({ kind: "checkout" })).rejects.toThrow("uncommitted");
  expect(f.writes).toHaveLength(1);
});

it("maps Git commit authors without logins, and paginates timeline events", async () => {
  const calls: string[][] = [];

  const run: Command = async (_root, _program, args) => {
    calls.push(args);

    return JSON.stringify([
      {
        event: "committed",
        sha: "abc",
        author: { name: "A contributor", date: "2026-09-10T00:00:00Z" },
        message: "A commit\n\nDetails",
      },
    ]);
  };

  const value = await runHost(prTimeline("/checkout", overview.url, 2), undefined, run);
  expect(calls[0]).toContain("repos/acme/api/issues/42/timeline?per_page=100&page=2");
  expect(value).toMatchObject({
    nextPage: null,
    entries: [
      { author: { login: "A contributor" }, title: "A commit", createdAt: "2026-09-10T00:00:00Z" },
    ],
  });
  expect(checkState("EXPECTED")).toBe("pending");
});

it("validates merge revisions and stack scope concurrently before any write", async () => {
  const f = fixture();
  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let stackStarted!: () => void;

  const started = new Promise<void>((resolve) => {
    stackStarted = resolve;
  });

  const run: Command = async (root, program, args, signal, body) => {
    if (body && JSON.parse(body).query === ACTION_PREFLIGHT_QUERY) await gate;

    if (args.some((arg) => arg.includes("/stacks?"))) stackStarted();

    return f.run(root, program, args, signal, body);
  };

  const result = runHost(
    prAction("/checkout", overview.url, overview.headRefOid, "main", {
      kind: "merge",
      method: "squash",
      auto: false,
      stack: null,
    }),
    undefined,
    run,
  );

  try {
    await started;
    expect(f.writes).toHaveLength(0);
  } finally {
    release();
    await result;
  }

  expect(f.writes).toHaveLength(1);
});

it.each([
  ["close", "closePullRequest", {}],
  ["reopen", "reopenPullRequest", { state: "CLOSED" }],
  ["ready", "markPullRequestReadyForReview", { isDraft: true }],
  ["draft", "convertPullRequestToDraft", {}],
  ["disable-auto-merge", "disablePullRequestAutoMerge", {}],
] as const)("%s writes directly using the validated PR ID", async (kind, mutation, pr) => {
  const f = fixture({ pr });
  await f.action({ kind });
  expect(f.writes).toHaveLength(1);
  const payload = JSON.parse(f.writes[0]!.body!);
  expect(payload.query).toContain(`result:${mutation}(input:{pullRequestId:$id})`);
  expect(payload.variables).toEqual({ id: overview.id });
});

it("keeps state changes idempotent and rejects stale revisions or missing permissions", async () => {
  const ready = fixture();
  await ready.action({ kind: "ready" });
  expect(ready.writes).toHaveLength(0);
  const denied = fixture({ pr: { canEdit: false } });
  await expect(denied.action({ kind: "close" })).rejects.toThrow("permission");
  expect(denied.writes).toHaveLength(0);
  const stale = fixture();
  await expect(stale.action({ kind: "comment", body: "hello" }, "f".repeat(40))).rejects.toThrow(
    "changed",
  );
  expect(stale.writes).toHaveLength(0);
});

it("propagates GraphQL state mutation errors instead of reporting success", async () => {
  const f = fixture();

  const run: Command = (root, program, args, signal, body) =>
    body && JSON.parse(body).query?.includes("result:")
      ? Promise.resolve(JSON.stringify({ errors: [{ message: "Permission revoked" }] }))
      : f.run(root, program, args, signal, body);

  await expect(
    runHost(
      prAction("/checkout", overview.url, overview.headRefOid, "main", { kind: "close" }),
      undefined,
      run,
    ),
  ).rejects.toThrow("Permission revoked");
});

it("preserves editable Markdown alongside GitHub HTML with resolved images", async () => {
  const body = "![Before](https://github.com/user-attachments/assets/private)";
  const bodyHTML =
    '<img src="https://private-user-images.githubusercontent.com/1/image.png?jwt=test" alt="Before">';
  const result = await runHost(
    prOverview("/repo", overview.url),
    undefined,
    async (_root, program, _args, _signal, input) => {
      if (program === "git") return "https://github.com/other/repo.git";
      expect(JSON.parse(input ?? "{}").query).toContain("bodyHTML");
      return JSON.stringify(rawOverview({ body, bodyHTML }));
    },
  );
  expect(result.body).toBe(body);
  expect(result.bodyHTML).toBe(bodyHTML);

  const timeline = await runHost(
    prTimeline("/repo", overview.url),
    undefined,
    async (_root, _program, args) => {
      expect(args).toContain("Accept: application/vnd.github.full+json");
      return JSON.stringify([{ id: 1, event: "commented", body, body_html: bodyHTML }]);
    },
  );
  expect(timeline.entries[0]?.body).toBe(body);
  expect(timeline.entries[0]?.bodyHTML).toBe(bodyHTML);
});
