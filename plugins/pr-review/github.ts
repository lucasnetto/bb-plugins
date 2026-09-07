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
      user: z.object({ login: z.string() }).nullable(),
      draft: z.boolean(),
      state: z.enum(["open", "closed"]),
      pull_request: z.object({ merged_at: z.string().nullable().optional() }).optional(),
      updated_at: z.string(),
    }),
  ),
});

export function githubQuery(view: View, viewer: string, state: PrState = "open") {
  // review-requested includes direct requests AND requests to the viewer's teams.
  // Omitting a draft qualifier includes both draft and ready PRs.
  return `is:pr ${state === "open" ? "is:open " : ""}${view === "authored" ? "author" : "review-requested"}:${viewer}`;
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
    state: item.pull_request?.merged_at ? "merged" : item.state,
    updatedAt: item.updated_at,
  }));
  return {
    viewer: login,
    rows,
    total: result.total_count,
    nextPage: page < 20 && page * 50 < result.total_count && rows.length > 0 ? page + 1 : null,
    incomplete: result.incomplete_results || result.total_count > 1000,
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
                `GitHub request failed. Check gh auth status on the workspace machine. ${stderr.trim().slice(0, 2000) || error.message}`,
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
