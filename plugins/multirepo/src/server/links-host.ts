import { join } from "node:path";
import { z } from "zod";
import { Effect } from "effect";
import { discover } from "./git";
import { command, decode, invalid } from "./host-effects";
import { linkedContentsInput, parsePrUrl, prSummarySchema } from "../shared/links-contract";
const viewSchema = z.object({
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  body: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  baseRefOid: z.string(),
  headRefOid: z.string(),
});
const view = Effect.fn("LinkedPr.view")(function* (root: string, url: string) {
  const ref = yield* decode(() => parsePrUrl(url));
  const raw = yield* command(root, "gh", [
    "pr",
    "view",
    ref.url,
    "--json",
    "title,state,isDraft,body,headRefName,baseRefName,baseRefOid,headRefOid",
  ]);
  const data = yield* decode(() => viewSchema.parse(JSON.parse(raw)));
  const pr = yield* decode(() => prSummarySchema.parse({ ...ref, ...data }));
  return { pr, data };
});
export const linkedSummary = Effect.fn("LinkedPr.summary")((root: string, url: string) =>
  view(root, url).pipe(Effect.map(({ pr }) => pr)),
);
export const linkedDetail = Effect.fn("LinkedPr.detail")(function* (root: string, url: string) {
  const ref = yield* decode(() => parsePrUrl(url));
  const [{ pr, data }, rawFiles, repos] = yield* Effect.all(
    [
      view(root, url),
      command(root, "gh", [
        "api",
        "--hostname",
        "github.com",
        "--paginate",
        "--slurp",
        `repos/${ref.repository}/pulls/${ref.number}/files`,
      ]),
      discover(root).pipe(Effect.catchTag("DiscoveryError", () => Effect.succeed([]))),
    ],
    { concurrency: 3 },
  );
  const files = yield* decode(() =>
    z
      .array(
        z.array(
          z.object({
            filename: z.string(),
            patch: z.string().optional(),
            status: z.string(),
            previous_filename: z.string().optional(),
          }),
        ),
      )
      .parse(JSON.parse(rawFiles))
      .flat(),
  );
  const matches = repos.filter((r) => r.remote?.toLowerCase() === ref.repository);
  return {
    pr,
    body: data.body,
    headRefName: data.headRefName,
    baseRefName: data.baseRefName,
    baseRefOid: data.baseRefOid,
    headRefOid: data.headRefOid,
    repositoryRoot: matches.length === 1 ? join(root, matches[0].name) : null,
    files: files.map((f) => ({
      path: f.filename,
      patch: f.patch ?? null,
      status: f.status,
      ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
    })),
  };
});

// Read immutable GitHub revisions, not files from the agent's working tree.
export const linkedContents = Effect.fn("LinkedPr.contents")(function* (
  root: string,
  input: z.infer<typeof linkedContentsInput>,
) {
  const { repository } = yield* decode(() => parsePrUrl(input.url));
  const api = (path: string, extra: string[] = []) =>
    command(root, "gh", ["api", "--hostname", "github.com", ...extra, path]);
  const rawComparison = yield* api(`repos/${repository}/compare/${input.base}...${input.head}`);
  const comparison = yield* decode(() =>
    z
      .object({ merge_base_commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }) })
      .parse(JSON.parse(rawComparison)),
  );
  const read = Effect.fn("LinkedPr.readRevision")(function* (path: string, sha: string) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const contents = yield* api(`repos/${repository}/contents/${encoded}?ref=${sha}`, [
      "-H",
      "Accept: application/vnd.github.raw+json",
    ]);
    if (contents.includes("\0"))
      return yield* invalid("Cannot expand binary file context. Open the file on GitHub.");
    return contents;
  });
  const [oldContents, newContents] = yield* Effect.all(
    [
      input.changeType === "new"
        ? Effect.succeed("")
        : read(input.oldPath, comparison.merge_base_commit.sha),
      input.changeType === "deleted" ? Effect.succeed("") : read(input.path, input.head),
    ],
    { concurrency: 2 },
  );
  return { oldContents, newContents };
});
