// Stack operations follow T3 Code's remote-only workflow; see ../ui/review/T3-LICENSE.
import { Effect } from "effect";
import { z } from "zod";
import { command, decode, invalid } from "./host-effects";
import { api, graphql, json, prOverview, prStack, repositoryVariables } from "./workspace-github";
import {
  mergeStatusSchema,
  type WorkspaceAction,
  type ActionResult,
  type PrStack,
  type StackHeads,
} from "../shared/workspace-contract";

export function stackScope(
  stack: PrStack | null,
  expected: StackHeads | null,
  number: number,
  whole: boolean,
) {
  if (!stack) {
    if (expected) throw new Error("The stack changed. Refresh before trying again.");
    return [];
  }
  const index = stack.layers.findIndex((layer) => layer.number === number);
  if (
    index < 0 ||
    !expected ||
    stack.number !== expected.number ||
    stack.base !== expected.base ||
    (whole && index !== stack.layers.length - 1)
  )
    throw new Error("The stack changed. Refresh before trying again.");
  const open = (whole ? stack.layers : stack.layers.slice(0, index + 1)).filter(
    (layer) => layer.state !== "MERGED",
  );
  if (
    !open.length ||
    open.length !== expected.heads.length ||
    open.some(
      (layer, i) =>
        layer.number !== expected.heads[i]?.number ||
        !layer.headRefOid ||
        layer.headRefOid !== expected.heads[i]?.headRefOid ||
        layer.state !== "OPEN",
    )
  )
    throw new Error("The stack changed. Refresh before trying again.");
  return open;
}
const branchResult = z.object({
  updatePullRequestBranch: z.object({ pullRequest: z.object({ headRefOid: z.string() }) }),
});
const updateBranch = (root: string, id: string, head: string, method: "merge" | "rebase") =>
  graphql(
    root,
    `
      mutation ($id: ID!, $head: GitObjectID!, $method: PullRequestBranchUpdateMethod!) {
        updatePullRequestBranch(
          input: { pullRequestId: $id, expectedHeadOid: $head, updateMethod: $method }
        ) {
          pullRequest {
            headRefOid
          }
        }
      }
    `,
    { id, head, method: method.toUpperCase() },
    branchResult,
  );

const rebaseStack = Effect.fn("PrWorkspace.rebaseStack")(function* (
  root: string,
  url: string,
  open: PrStack["layers"],
) {
  const { owner, name } = yield* decode(() => repositoryVariables(url));
  const access = yield* graphql(
    root,
    `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${open.map((layer) => `p${layer.number}:pullRequest(number:${layer.number}){headRepository{viewerPermission} maintainerCanModify}`).join(" ")}}}`,
    { owner, name },
    z.object({
      repository: z.record(
        z.string(),
        z
          .object({
            headRepository: z.object({ viewerPermission: z.string().nullable() }).nullable(),
            maintainerCanModify: z.boolean(),
          })
          .nullable(),
      ),
    }),
  );
  if (
    open.some((layer) => {
      const pr = access.repository[`p${layer.number}`];
      return (
        !pr?.headRepository ||
        (!pr.maintainerCanModify &&
          !["ADMIN", "MAINTAIN", "WRITE"].includes(pr.headRepository.viewerPermission ?? ""))
      );
    })
  )
    return yield* invalid("You need permission to update every branch in this stack.");
  const processed: { id: string; head: string }[] = [];
  for (const layer of open) {
    yield* Effect.gen(function* () {
      const current = yield* graphql(
        root,
        `
          query ($owner: String!, $name: String!, $number: Int!, $sha: String!, $ids: [ID!]!) {
            processed: nodes(ids: $ids) {
              ... on PullRequest {
                headRefOid
              }
            }
            repository(owner: $owner, name: $name) {
              pullRequest(number: $number) {
                id
                headRefOid
                baseRef {
                  compare(headRef: $sha) {
                    behindBy
                  }
                }
              }
            }
          }
        `,
        {
          owner,
          name,
          number: layer.number,
          sha: layer.headRefOid,
          ids: processed.map((pr) => pr.id),
        },
        z.object({
          processed: z.array(z.object({ headRefOid: z.string() }).nullable()),
          repository: z.object({
            pullRequest: z.object({
              id: z.string(),
              headRefOid: z.string(),
              baseRef: z.object({ compare: z.object({ behindBy: z.number() }) }).nullable(),
            }),
          }),
        }),
      );
      const pr = current.repository.pullRequest;
      if (
        pr.headRefOid !== layer.headRefOid ||
        !pr.baseRef ||
        processed.some((entry, index) => current.processed[index]?.headRefOid !== entry.head)
      )
        return yield* invalid("A branch changed during the stack rebase.");
      const nextHead =
        pr.baseRef.compare.behindBy === 0
          ? pr.headRefOid
          : (yield* updateBranch(root, pr.id, pr.headRefOid, "rebase")).updatePullRequestBranch
              .pullRequest.headRefOid;
      processed.push({ id: pr.id, head: nextHead });
    }).pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Stack rebase stopped at #${layer.number} after ${processed.length} layers. Earlier updates remain on GitHub. ${error.message}`,
          ),
      ),
    );
  }
});

export const prAction = Effect.fn("PrWorkspace.action")(function* (
  root: string,
  url: string,
  head: string,
  base: string,
  action: WorkspaceAction,
) {
  const current = yield* prOverview(root, url);
  if (current.headRefOid !== head || current.baseRefName !== base)
    return yield* invalid(
      "This pull request changed. Refresh and review its latest revision first.",
    );
  const ref = yield* decode(() => repositoryVariables(url));
  const endpoint = `repos/${ref.repository}`;
  const runPr = (subcommand: string, flags: string[] = [], body?: string) =>
    command(root, "gh", ["pr", subcommand, ref.url, ...flags], body);
  const done = (message: string): ActionResult => ({ message, pendingMergeId: null });
  if (action.kind === "comment") {
    yield* runPr("comment", ["--body-file", "-"], action.body);
    return done("Comment posted.");
  }
  if (action.kind === "checkout") {
    if (!current.checkoutRoot)
      return yield* invalid("Open this PR in a thread with a matching repository to check it out.");
    const changes = yield* command(current.checkoutRoot, "git", ["status", "--porcelain"]);
    if (changes.trim())
      return yield* invalid(
        "This checkout has uncommitted changes. Commit or stash them before checking out the PR.",
      );
    yield* command(current.checkoutRoot, "gh", ["pr", "checkout", ref.url]);
    return done(`Checked out ${current.headRefName}.`);
  }
  if (action.kind === "merge" || action.kind === "update-branch") {
    if (current.state !== "OPEN") return yield* invalid("This pull request is no longer open.");
    const stack = yield* prStack(root, url, false);
    const open = yield* decode(() =>
      stackScope(stack, action.stack, ref.number, action.kind === "update-branch"),
    );
    if (action.kind === "update-branch") {
      if (stack) {
        yield* rebaseStack(root, url, open);
        return done("Stack rebased onto its base branch.");
      }
      if (!current.canUpdateBranch)
        return yield* invalid("GitHub does not allow updating this branch right now.");
      yield* updateBranch(root, current.id, head, action.method);
      return done("Branch updated.");
    }
    if (!current.canMerge || current.isDraft || open.some((layer) => layer.isDraft))
      return yield* invalid(
        "All affected pull requests must be ready for review, and you need merge permission.",
      );
    if (!current.mergeMethods.includes(action.method))
      return yield* invalid("This merge method is disabled for the repository.");
    if (stack) {
      if (action.auto)
        return yield* invalid(
          "Auto-merge is not supported for stacks. Merge or queue the stack instead.",
        );
      const result = yield* json(
        mergeStatusSchema,
        yield* api(root, `${endpoint}/pulls/${ref.number}/merge-async`, "PUT", {
          sha: head,
          merge_method: action.method,
          merge_action: "default",
        }),
      );
      if (result.status === "failed")
        return yield* invalid(result.details.message ?? "GitHub refused the stack merge.");
      if (result.status === "pending" && !result.details.uuid)
        return yield* invalid(
          "GitHub accepted the merge but did not return a status identifier. Check GitHub before retrying.",
        );
      return {
        message:
          result.status === "pending"
            ? "GitHub is merging the stack…"
            : result.status === "enqueued"
              ? "Stack added to the merge queue."
              : "Stack merged.",
        pendingMergeId: result.status === "pending" ? (result.details.uuid ?? null) : null,
      };
    }
    if (action.auto && !current.autoMergeAllowed)
      return yield* invalid("Auto-merge is disabled for this repository.");
    yield* runPr("merge", [
      `--${action.method}`,
      "--match-head-commit",
      head,
      ...(action.auto ? ["--auto"] : []),
    ]);
    return done(action.auto ? "Auto-merge enabled." : "Merge submitted to GitHub.");
  }
  if (!current.canEdit)
    return yield* invalid("You do not have permission to update this pull request.");
  switch (action.kind) {
    case "edit":
      if (current.updatedAt !== action.updatedAt)
        return yield* invalid("The title or description changed. Refresh before saving.");
      yield* api(root, `${endpoint}/pulls/${ref.number}`, "PATCH", {
        title: action.title,
        body: action.body,
      });
      return done("Pull request updated.");
    case "labels":
      if (current.updatedAt !== action.updatedAt)
        return yield* invalid("This pull request changed. Refresh before changing labels.");
      yield* api(root, `${endpoint}/issues/${ref.number}/labels`, "PUT", { labels: action.labels });
      return done("Labels updated.");
    case "reviewers":
      yield* api(
        root,
        `${endpoint}/pulls/${ref.number}/requested_reviewers`,
        action.remove ? "DELETE" : "POST",
        { reviewers: action.users, team_reviewers: action.teams },
      );
      return done(action.remove ? "Review request removed." : "Review requested.");
    case "close":
      if (current.state !== "OPEN") return yield* invalid("This pull request is not open.");
      yield* runPr("close");
      return done("Pull request closed.");
    case "reopen":
      if (current.state !== "CLOSED")
        return yield* invalid("Only closed, unmerged pull requests can be reopened.");
      yield* runPr("reopen");
      return done("Pull request reopened.");
    case "ready":
    case "draft":
      if (current.state !== "OPEN") return yield* invalid("This pull request is not open.");
      yield* runPr("ready", action.kind === "draft" ? ["--undo"] : []);
      return done(action.kind === "draft" ? "Converted to draft." : "Marked ready for review.");
    case "disable-auto-merge":
      yield* runPr("merge", ["--disable-auto"]);
      return done("Auto-merge disabled.");
  }
});
export const prMergeStatus = Effect.fn("PrWorkspace.mergeStatus")(function* (
  root: string,
  url: string,
  id: string,
) {
  const ref = yield* decode(() => repositoryVariables(url));
  return yield* json(
    mergeStatusSchema,
    yield* api(
      root,
      `repos/${ref.repository}/pulls/${ref.number}/merge-async/${encodeURIComponent(id)}`,
    ),
  );
});
