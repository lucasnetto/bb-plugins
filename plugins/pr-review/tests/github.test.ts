import { describe, expect, it } from "vite-plus/test";
import { githubQuery, listPullRequests, type Gh } from "../github";

const item = {
  html_url: "https://github.com/acme/api/pull/42",
  number: 42,
  title: "Change",
  user: { login: "lucas" },
  draft: true,
  state: "open",
  updated_at: "2026-09-07T12:00:00Z",
};
function api(total = 1, incomplete = false) {
  const calls: string[][] = [];
  const gh: Gh = async (args) => {
    calls.push(args);
    return args.includes("user")
      ? { login: "lucas" }
      : { total_count: total, incomplete_results: incomplete, items: [item] };
  };
  return { gh, calls };
}
describe("GitHub PR inbox", () => {
  it("fetches all states and identifies closed and merged PRs", async () => {
    const calls: string[][] = [];
    const result = await listPullRequests(
      async (args) => {
        calls.push(args);
        return args.includes("user")
          ? { login: "lucas" }
          : {
              total_count: 2,
              incomplete_results: false,
              items: [
                { ...item, state: "closed" },
                { ...item, state: "closed", pull_request: { merged_at: "2026-09-07T12:00:00Z" } },
              ],
            };
      },
      { view: "authored", page: 1, state: "all" },
    );
    expect(calls[1]).toContain("q=is:pr author:lucas");
    expect(result.rows.map((row) => row.state)).toEqual(["closed", "merged"]);
    expect(githubQuery("reviewing", "lucas", "all")).toBe("is:pr review-requested:lucas");
  });
  it("includes drafts and open authored PRs without restricting repositories", async () => {
    const { gh, calls } = api();
    const result = await listPullRequests(gh, { view: "authored", page: 1 });
    expect(result.rows[0]).toMatchObject({
      isDraft: true,
      repository: "acme/api",
      author: "lucas",
    });
    expect(calls[1]).toContain("q=is:pr is:open author:lucas");
    expect(calls[1]).toContain("sort=updated");
    expect(result.nextPage).toBeNull();
  });
  it("uses GitHub's inclusive reviewer qualifier for user and team requests", async () => {
    const { gh, calls } = api();
    await listPullRequests(gh, { view: "reviewing", page: 1 });
    expect(calls[1]).toContain("q=is:pr is:open review-requested:lucas");
    expect(githubQuery("reviewing", "lucas")).not.toContain("user-review-requested:");
  });
  it("paginates and explicitly reports the GitHub search limit", async () => {
    expect((await listPullRequests(api(51).gh, { view: "authored", page: 1 })).nextPage).toBe(2);
    const result = await listPullRequests(api(1001).gh, { view: "authored", page: 20 });
    expect(result.nextPage).toBeNull();
    expect(result.incomplete).toBe(true);
    expect(
      (await listPullRequests(api(1, true).gh, { view: "authored", page: 1 })).incomplete,
    ).toBe(true);
  });
  it("propagates auth errors and rejects malformed responses and page inputs", async () => {
    await expect(
      listPullRequests(
        async () => {
          throw new Error("auth required");
        },
        { view: "authored", page: 1 },
      ),
    ).rejects.toThrow("auth required");
    await expect(
      listPullRequests(async () => ({}), { view: "authored", page: 1 }),
    ).rejects.toThrow();
    const { gh, calls } = api();
    await expect(listPullRequests(gh, { view: "authored", page: 21 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
