import { Effect, Match } from "effect";
import { z } from "zod";
import { command, decode, invalid } from "./host-effects";
import { matchingCheckout } from "./checkout";
import { parsePrUrl } from "../shared/links-contract";
import {
  actorSchema,
  labelSchema,
  overviewSchema,
  stackSchema,
  type Check,
} from "../shared/workspace-contract";

type RepositoryVariables = {
  owner: string | undefined;
  name: string | undefined;
  number?: number;
  sha?: string | null;
  ids?: string[];
};

type BranchVariables = { id: string; head: string; method: string };

type GraphqlVariables = RepositoryVariables | BranchVariables;

type WorkspaceApiBody =
  | { query: string; variables: GraphqlVariables }
  | { sha: string; merge_method: "merge" | "squash" | "rebase"; merge_action: "default" }
  | { title: string; body: string }
  | { labels: string[] }
  | { reviewers: string[]; team_reviewers: string[] };

export const api = (root: string, path: string, method = "GET", body?: WorkspaceApiBody) =>
  command(
    root,
    "gh",
    [
      "api",
      "--hostname",
      "github.com",
      "--method",
      method,
      path,
      ...(body === undefined ? [] : ["--input", "-"]),
    ],
    body === undefined ? undefined : JSON.stringify(body),
  );

export function json<A>(schema: z.ZodType<A>, raw: string) {
  return decode(() => schema.parse(JSON.parse(raw)));
}

export function graphql<A>(
  root: string,
  query: string,
  variables: GraphqlVariables,
  schema: z.ZodType<A>,
) {
  return Effect.gen(function* () {
    const raw = yield* api(root, "graphql", "POST", { query, variables });

    const result = yield* json(
      z.object({
        data: z.unknown().optional(),
        errors: z.array(z.object({ message: z.string() })).optional(),
      }),
      raw,
    );

    if (result.errors?.length)
      return yield* invalid(result.errors.map((e) => e.message).join("; "));

    return yield* decode(() => schema.parse(result.data));
  });
}

export const repositoryVariables = (url: string) => {
  const ref = parsePrUrl(url);
  const [owner, name] = ref.repository.split("/");

  return { ...ref, owner, name };
};

const nodes = <T extends z.ZodType>(schema: T) => z.object({ nodes: z.array(schema) });

const rawCheck = z.object({
  __typename: z.string(),
  name: z.string().optional(),
  context: z.string().optional(),
  status: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  state: z.string().optional(),
  detailsUrl: z.string().nullable().optional(),
  targetUrl: z.string().nullable().optional(),
});

export function checkState(value: string | null | undefined): Check["state"] {
  if (value === "SUCCESS") return "success";

  if (
    [
      "FAILURE",
      "ERROR",
      "CANCELLED",
      "TIMED_OUT",
      "ACTION_REQUIRED",
      "STARTUP_FAILURE",
      "STALE",
    ].includes(value ?? "")
  )
    return "failure";

  if (["NEUTRAL", "SKIPPED"].includes(value ?? "")) return "skipped";

  return "pending";
}

export const OVERVIEW_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  viewer{login}
  repository(owner:$owner,name:$name){viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed
    pullRequest(number:$number){id url number title body state isDraft updatedAt createdAt
      author{login avatarUrl} headRefName baseRefName headRefOid baseRefOid additions deletions changedFiles
      mergeable mergeStateStatus reviewDecision viewerCanUpdate viewerCanUpdateBranch autoMergeRequest{enabledAt}
      labels(first:100){nodes{name color}}
      reviewRequests(first:100){nodes{requestedReviewer{__typename ... on User{login} ... on Team{slug}}}}
      comments{totalCount}
      commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{
        __typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}
      }}}}}}
    }
  }
}`;

const overviewRaw = z.object({
  viewer: z.object({ login: z.string() }),
  repository: z.object({
    viewerPermission: z.string().nullable(),
    mergeCommitAllowed: z.boolean(),
    squashMergeAllowed: z.boolean(),
    rebaseMergeAllowed: z.boolean(),
    autoMergeAllowed: z.boolean(),
    pullRequest: z.object({
      id: z.string(),
      url: z.string(),
      number: z.number(),
      title: z.string(),
      body: z.string(),
      state: z.enum(["OPEN", "CLOSED", "MERGED"]),
      isDraft: z.boolean(),
      author: actorSchema.nullable(),
      updatedAt: z.string(),
      createdAt: z.string(),
      headRefName: z.string(),
      baseRefName: z.string(),
      headRefOid: z.string(),
      baseRefOid: z.string(),
      additions: z.number(),
      deletions: z.number(),
      changedFiles: z.number(),
      mergeable: z.string(),
      mergeStateStatus: z.string(),
      reviewDecision: z.string().nullable(),
      viewerCanUpdate: z.boolean(),
      viewerCanUpdateBranch: z.boolean(),
      autoMergeRequest: z.object({ enabledAt: z.string() }).nullable(),
      labels: nodes(labelSchema),
      comments: z.object({ totalCount: z.number() }),
      reviewRequests: nodes(
        z.object({
          requestedReviewer: z
            .object({
              __typename: z.string(),
              login: z.string().optional(),
              slug: z.string().optional(),
            })
            .nullable(),
        }),
      ),
      commits: nodes(
        z.object({
          commit: z.object({
            statusCheckRollup: z
              .object({
                contexts: nodes(rawCheck).extend({
                  pageInfo: z.object({ hasNextPage: z.boolean() }),
                }),
              })
              .nullable(),
          }),
        }),
      ),
    }),
  }),
});

export const prOverview = Effect.fn("PrWorkspace.overview")(function* (root: string, url: string) {
  const ref = yield* decode(() => repositoryVariables(url));

  const [data, checkoutRoot] = yield* Effect.all(
    [
      graphql(
        root,
        OVERVIEW_QUERY,
        { owner: ref.owner, name: ref.name, number: ref.number },
        overviewRaw,
      ),
      matchingCheckout(root, ref.repository),
    ],
    { concurrency: 2 },
  );

  const { pullRequest: pr, ...repo } = data.repository;
  const contexts = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts;

  return yield* decode(() =>
    overviewSchema.parse({
      ...pr,
      repository: ref.repository,
      viewer: data.viewer.login,
      canEdit: pr.viewerCanUpdate,
      canMerge: ["ADMIN", "MAINTAIN", "WRITE"].includes(repo.viewerPermission ?? ""),
      canUpdateBranch: pr.viewerCanUpdateBranch,
      mergeMethods: [
        repo.mergeCommitAllowed && "merge",
        repo.squashMergeAllowed && "squash",
        repo.rebaseMergeAllowed && "rebase",
      ].filter(Boolean),
      autoMergeAllowed: repo.autoMergeAllowed,
      autoMerge: pr.autoMergeRequest !== null,
      labels: pr.labels.nodes,
      reviewers: pr.reviewRequests.nodes.flatMap(({ requestedReviewer: actor }) =>
        actor && (actor.login || actor.slug)
          ? [
              {
                login: actor.login ?? actor.slug,
                kind: actor.__typename === "Team" ? "team" : "user",
              },
            ]
          : [],
      ),
      checks: (contexts?.nodes ?? []).map((check) => ({
        name: check.name ?? check.context ?? "Check",
        state: checkState(
          check.__typename === "CheckRun"
            ? check.status === "COMPLETED"
              ? check.conclusion
              : check.status
            : check.state,
        ),
        url: check.detailsUrl ?? check.targetUrl ?? null,
      })),
      checksTruncated: contexts?.pageInfo.hasNextPage ?? false,
      commentCount: pr.comments.totalCount,
      checkoutRoot,
    }),
  );
});

const rawStack = z.object({
  number: z.number().int().positive(),
  base: z.union([z.string(), z.object({ ref: z.string() }).transform((base) => base.ref)]),
  pull_requests: z.array(
    z.object({
      number: z.number().int().positive(),
      title: z.string().optional(),
      draft: z.boolean().optional(),
      head: z.object({ ref: z.string(), sha: z.string().optional() }),
      state: z.string().nullable().optional(),
      merged_at: z.string().nullable().optional(),
    }),
  ),
});

// Native stacks are ordered bottom to top. A preview-unavailable 404 means no stack;
// auth/network failures remain errors so a merge can never silently lose its scope.
export const prStack = Effect.fn("PrWorkspace.stack")(function* (
  root: string,
  url: string,
  hydrate = true,
) {
  const ref = yield* decode(() => parsePrUrl(url));

  const raw = yield* api(root, `repos/${ref.repository}/stacks?pull_request=${ref.number}`).pipe(
    Effect.catchTag("CommandError", (error) =>
      /\b404\b/.test(error.message) ? Effect.succeed("[]") : Effect.fail(error),
    ),
  );

  const first = (yield* json(z.array(rawStack), raw))[0];

  if (!first) return null;
  const titles = new Map<number, string>();

  if (hydrate && first.pull_requests.some((pr) => !pr.title)) {
    const { owner, name } = repositoryVariables(url);

    const data = yield* graphql(
      root,
      `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${first.pull_requests.map((pr) => `p${pr.number}:pullRequest(number:${pr.number}){number title}`).join(" ")}}}`,
      { owner, name },
      z.object({
        repository: z.record(
          z.string(),
          z.object({ number: z.number(), title: z.string() }).nullable(),
        ),
      }),
    );

    for (const pr of Object.values(data.repository)) if (pr) titles.set(pr.number, pr.title);
  }

  return yield* decode(() =>
    stackSchema.parse({
      number: first.number,
      base: first.base,
      layers: first.pull_requests.map((pr) => ({
        number: pr.number,
        title: pr.title ?? titles.get(pr.number) ?? `Pull request #${pr.number}`,
        url: `https://github.com/${ref.repository}/pull/${pr.number}`,
        headRefName: pr.head.ref,
        headRefOid: pr.head.sha ?? null,
        isDraft: pr.draft ?? false,
        state:
          pr.merged_at || pr.state?.toLowerCase() === "merged"
            ? "MERGED"
            : pr.state?.toLowerCase() === "closed"
              ? "CLOSED"
              : "OPEN",
      })),
    }),
  );
});

export const prCandidates = Effect.fn("PrWorkspace.candidates")(function* (
  root: string,
  url: string,
) {
  const { owner, name } = yield* decode(() => repositoryVariables(url));

  return yield* graphql(
    root,
    `
      query ($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          labels(first: 100) {
            nodes {
              name
              color
            }
          }
          assignableUsers(first: 100) {
            nodes {
              login
              avatarUrl
            }
          }
        }
      }
    `,
    { owner, name },
    z.object({
      repository: z.object({ labels: nodes(labelSchema), assignableUsers: nodes(actorSchema) }),
    }),
  ).pipe(
    Effect.map(({ repository }) => ({
      labels: repository.labels.nodes,
      users: repository.assignableUsers.nodes,
      teams: [],
    })),
  );
});

const restActor = z
  .object({ login: z.string(), avatar_url: z.string().nullable().optional() })
  .nullable()
  .optional();

const rawActivity = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  event: z.string().optional(),
  actor: restActor,
  user: restActor,
  author: z
    .object({
      login: z.string().optional(),
      name: z.string().optional(),
      date: z.string().optional(),
      avatar_url: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  body: z.string().nullable().optional(),
  state: z.string().nullish(),
  created_at: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
  sha: z.string().nullish(),
  message: z.string().nullish(),
  commit_id: z.string().nullish(),
  label: z.object({ name: z.string() }).nullish(),
  commit_url: z.string().nullish(),
  dismissed_review: z.object({ state: z.string().nullish() }).nullish(),
});

export const prTimeline = Effect.fn("PrWorkspace.timeline")(function* (
  root: string,
  url: string,
  page = 1,
) {
  const ref = yield* decode(() => parsePrUrl(url));

  const raw = yield* api(
    root,
    `repos/${ref.repository}/issues/${ref.number}/timeline?per_page=100&page=${page}`,
  );

  const rows = yield* json(z.array(rawActivity), raw);

  return {
    entries: rows.map((entry, index) => {
      const actor = entry.actor ?? entry.user ?? entry.author;

      const kind = Match.value(entry.event).pipe(
        Match.when("commented", () => "comment" as const),
        Match.when("reviewed", () => "review" as const),
        Match.when("committed", () => "commit" as const),
        Match.orElse(() => "event" as const),
      );

      return {
        id: String(entry.id ?? entry.sha ?? `${page}:${entry.event}:${index}`),
        kind,
        author: actor
          ? {
              login: actor.login ?? entry.author?.name ?? "unknown",
              avatarUrl: actor.avatar_url ?? null,
            }
          : null,
        body: entry.body ?? "",
        createdAt: entry.created_at ?? entry.submitted_at ?? entry.author?.date ?? "",
        url:
          entry.html_url ??
          (entry.sha ? `https://github.com/${ref.repository}/commit/${entry.sha}` : null),
        title: Match.value(kind).pipe(
          Match.when("commit", () => entry.message?.split("\n")[0] ?? "Pushed a commit"),
          Match.when("review", () =>
            (entry.state ?? "reviewed").toLowerCase().replaceAll("_", " "),
          ),
          Match.when("comment", () => "commented"),
          Match.when(
            "event",
            () =>
              `${(entry.event ?? "updated").replaceAll("_", " ")}${entry.label ? ` ${entry.label.name}` : ""}`,
          ),
          Match.exhaustive,
        ),
        state: entry.state ?? null,
      };
    }),
    truncated: rows.length === 100,
    nextPage: rows.length === 100 ? page + 1 : null,
  };
});
