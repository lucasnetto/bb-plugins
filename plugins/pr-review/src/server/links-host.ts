import { Effect, Schema } from "effect";
import { matchingCheckout } from "./checkout";
import { command, decode, invalid, decodeSchema } from "./host-effects";
import { linkedContentsInput, parsePrUrl, prSummarySchema } from "../shared/links-contract";
const viewSchema = Schema.Struct({
  title: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  body: Schema.String,
  headRefName: Schema.String,
  baseRefName: Schema.String,
  baseRefOid: Schema.String,
  headRefOid: Schema.String,
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
  const data = yield* decodeSchema(Schema.fromJsonString(viewSchema), raw);
  const pr = yield* decodeSchema(prSummarySchema, { ...ref, ...data });
  return { pr, data };
});
export const linkedSummary = Effect.fn("LinkedPr.summary")((root: string, url: string) =>
  view(root, url).pipe(Effect.map(({ pr }) => pr)),
);
export const linkedDetail = Effect.fn("LinkedPr.detail")(function* (root: string, url: string) {
  const ref = yield* decode(() => parsePrUrl(url));
  const [{ pr, data }, rawFiles, repositoryRoot] = yield* Effect.all(
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
      matchingCheckout(root, ref.repository),
    ],
    { concurrency: 3 },
  );
  const files = yield* decodeSchema(
    Schema.fromJsonString(
      Schema.mutable(
        Schema.Array(
          Schema.mutable(
            Schema.Array(
              Schema.Struct({
                filename: Schema.String,
                patch: Schema.optionalKey(Schema.String),
                status: Schema.String,
                previous_filename: Schema.optionalKey(Schema.String),
              }),
            ),
          ),
        ),
      ),
    ),
    rawFiles,
  ).pipe(Effect.map((decoded) => decoded.flat()));
  return {
    pr,
    body: data.body,
    headRefName: data.headRefName,
    baseRefName: data.baseRefName,
    baseRefOid: data.baseRefOid,
    headRefOid: data.headRefOid,
    repositoryRoot,
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
  input: Schema.Schema.Type<typeof linkedContentsInput>,
) {
  const { repository } = yield* decode(() => parsePrUrl(input.url));
  const api = (path: string, extra: string[] = []) =>
    command(root, "gh", ["api", "--hostname", "github.com", ...extra, path]);
  const rawComparison = yield* api(`repos/${repository}/compare/${input.base}...${input.head}`);
  const comparison = yield* decodeSchema(
    Schema.fromJsonString(
      Schema.Struct({
        merge_base_commit: Schema.Struct({
          sha: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
        }),
      }),
    ),
    rawComparison,
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
