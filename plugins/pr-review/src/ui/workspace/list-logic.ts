import { Match } from "effect";
import type { PullRequest, PrState } from "../../../contract";

export type Sort = "updated" | "newest" | "oldest" | "title" | "size";

export const SORT_OPTIONS = [
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title" },
  { value: "size", label: "Most changes" },
] as const;

export interface Filters {
  involvement: string;
  repository: string;
  draft: string;
  checks: string;
  review: string;
}

export const DEFAULT_FILTERS: Filters = {
  involvement: "all",
  repository: "",
  draft: "all",
  checks: "all",
  review: "all",
};

export function matchesQuery(pr: PullRequest, query: string, state: PrState = "all") {
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];

  return tokens.every((token) => {
    const negative = token.startsWith("-");
    const term = (negative ? token.slice(1) : token).replaceAll('"', "").toLowerCase();
    const match = term.match(/^(label|author|repo|is):(.+)$/);
    let found: boolean;

    if (match) {
      const value = match[2]!;

      switch (match[1]) {
        case "label":
          found = !!pr.labels?.some((label) => label.name.toLowerCase() === value);
          break;
        case "author":
          found = pr.author.toLowerCase() === value.replace(/^@/, "");
          break;
        case "repo":
          found = pr.repository.toLowerCase().includes(value);
          break;
        default:
          found =
            value === "draft"
              ? pr.isDraft
              : value === "open"
                ? state === "all" || state === "ready"
                : value === "closed" || value === "merged"
                  ? state === value
                  : value === "stacked"
                    ? !!pr.stack
                    : false;
      }
    } else
      found = `${pr.title} ${pr.repository} #${pr.number} ${pr.author} ${pr.headRefName ?? ""}`
        .toLowerCase()
        .includes(term);

    return negative ? !found : found;
  });
}

export function visibleRows(
  rows: PullRequest[],
  query: string,
  filters: Filters,
  sort: Sort,
  state: PrState = "all",
) {
  return rows
    .filter(
      (pr) =>
        (!filters.repository || pr.repository === filters.repository) &&
        (filters.draft === "all" || pr.isDraft === (filters.draft === "only")) &&
        (filters.checks === "all" ||
          (filters.checks === "passing"
            ? pr.checksState === "SUCCESS"
            : ["FAILURE", "ERROR"].includes(pr.checksState ?? ""))) &&
        (filters.review === "all" || pr.reviewDecision === filters.review) &&
        matchesQuery(pr, query, state),
    )
    .sort((a, b) =>
      Match.value(sort).pipe(
        Match.when("title", () => a.title.localeCompare(b.title)),
        Match.when(
          "size",
          () => (b.additions ?? 0) + (b.deletions ?? 0) - (a.additions ?? 0) - (a.deletions ?? 0),
        ),
        Match.when("oldest", () =>
          (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt),
        ),
        Match.when("newest", () =>
          (b.createdAt ?? b.updatedAt).localeCompare(a.createdAt ?? a.updatedAt),
        ),
        Match.when("updated", () => b.updatedAt.localeCompare(a.updatedAt)),
        Match.exhaustive,
      ),
    );
}
