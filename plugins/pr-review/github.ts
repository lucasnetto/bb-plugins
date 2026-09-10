import { execFile } from "node:child_process";
import { z } from "zod";
import { listInput, prUrl, type ListResult, type View, type PrState } from "./contract";

export type Gh = (args: string[]) => Promise<unknown>;
const viewerSchema = z.object({ login: z.string().regex(/^[\w-]+$/) });
const searchSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(
    z.object({
      html_url: prUrl,
      number: z.number().int().positive(),
      title: z.string(),
      user: z
        .object({ login: z.string(), avatar_url: z.string().nullable().optional() })
        .nullable(),
      draft: z.boolean(),
      updated_at: z.string(),
      created_at: z.string().optional(),
      node_id: z.string().optional(),
      labels: z.array(z.object({ name: z.string(), color: z.string() })).optional(),
    }),
  ),
});

export function githubQuery(view: View, viewer: string, state: PrState = "all") {
  // review-requested includes direct requests AND requests to the viewer's teams.
  // Omitting a draft qualifier includes both draft and ready PRs.
  const status =
    state === "merged" ? "is:merged" : state === "closed" ? "is:closed is:unmerged" : "is:open";
  return `is:pr ${status} ${view === "authored" ? "author" : "review-requested"}:${viewer}${state === "ready" ? " draft:false" : ""}`;
}

export async function listPullRequests(
  gh: Gh,
  input: { view: View; page: number; state?: PrState },
): Promise<ListResult> {
  const { view, page, state } = listInput.parse(input);
  const { login } = viewerSchema.parse(await gh(["api", "--hostname", "github.com", "user"]));
  const result = searchSchema.parse(
    await gh([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
      "search/issues",
      "-f",
      `q=${githubQuery(view, login, state)}`,
      "-f",
      "sort=updated",
      "-f",
      "order=desc",
      "-f",
      "per_page=50",
      "-f",
      `page=${page}`,
    ]),
  );
  const rows: ListResult["rows"] = result.items.map((item) => ({
    url: item.html_url,
    repository: new URL(item.html_url).pathname.split("/").slice(1, 3).join("/"),
    number: item.number,
    title: item.title,
    author: item.user?.login ?? "ghost",
    isDraft: item.draft,
    updatedAt: item.updated_at,
    ...(item.created_at ? { createdAt: item.created_at } : {}),
    avatarUrl: item.user?.avatar_url ?? null,
    labels: item.labels ?? [],
  }));
  let metadataError: string | undefined;
  const ids = result.items.flatMap((item) => (item.node_id ? [item.node_id] : []));
  if (ids.length) {
    try {
      const query = (stacks: boolean) =>
        `query {
          nodes(ids: ${JSON.stringify(ids)}) {
            ... on PullRequest {
              url additions deletions headRefName baseRefName mergeable reviewDecision
              commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
              ${stacks ? "stack{number size baseRefName} stackEntry{position}" : ""}
            }
          }
        }`;
      const read = (stacks: boolean) =>
        gh(["api", "--hostname", "github.com", "graphql", "-f", `query=${query(stacks)}`]);
      let enriched: unknown;
      try {
        enriched = await read(true);
      } catch (error) {
        // Older GitHub schemas do not expose the stacks preview. Keep stats available.
        if (!/stack|stackEntry/.test(String(error))) throw error;
        enriched = await read(false);
      }
      const decoded = z
        .object({
          data: z.object({
            nodes: z.array(
              z
                .object({
                  url: z.string(),
                  additions: z.number(),
                  deletions: z.number(),
                  headRefName: z.string(),
                  baseRefName: z.string(),
                  mergeable: z.string(),
                  reviewDecision: z.string().nullable(),
                  commits: z.object({
                    nodes: z.array(
                      z.object({
                        commit: z.object({
                          statusCheckRollup: z.object({ state: z.string() }).nullable(),
                        }),
                      }),
                    ),
                  }),
                  stack: z
                    .object({ number: z.number(), size: z.number(), baseRefName: z.string() })
                    .nullable()
                    .optional(),
                  stackEntry: z.object({ position: z.number() }).nullable().optional(),
                })
                .nullable(),
            ),
          }),
        })
        .parse(enriched);
      const metadata = new Map(
        decoded.data.nodes.flatMap((pr) => (pr ? [[pr.url, pr] as const] : [])),
      );
      for (const row of rows) {
        const extra = metadata.get(row.url);
        if (extra)
          Object.assign(row, {
            additions: extra.additions,
            deletions: extra.deletions,
            headRefName: extra.headRefName,
            baseRefName: extra.baseRefName,
            mergeable: extra.mergeable,
            reviewDecision: extra.reviewDecision,
            checksState: extra.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
            stack:
              extra.stack && extra.stackEntry
                ? {
                    number: extra.stack.number,
                    size: extra.stack.size,
                    base: extra.stack.baseRefName,
                    position: extra.stackEntry.position,
                  }
                : null,
          });
      }
    } catch {
      metadataError =
        "Some PR checks, line counts, and stack information could not be loaded. Refresh to retry.";
    }
  }
  return {
    viewer: login,
    rows,
    total: result.total_count,
    nextPage: page < 20 && page * 50 < result.total_count && rows.length > 0 ? page + 1 : null,
    incomplete: result.incomplete_results || result.total_count > 1000,
    ...(metadataError ? { metadataError } : {}),
  };
}

export function ghClient(root: string, signal: AbortSignal): Gh {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        "gh",
        args,
        {
          cwd: root,
          signal,
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `GitHub request failed. Check gh auth status on BB’s primary machine. ${stderr.trim().slice(0, 2000) || error.message}`,
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("GitHub returned invalid JSON."));
          }
        },
      );
    });
}
