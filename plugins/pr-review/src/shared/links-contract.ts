import { Schema, Struct } from "effect";

export { LINKS_CHANGED } from "./links-events";

export const reasonSchema = Schema.Literals([
  "created-here",
  "requested-review",
  "requested-work",
  "manual",
]);

export const linkInput = Schema.Struct({ url: Schema.String, reason: reasonSchema });

export const threadInput = Schema.Struct({ threadId: Schema.String.check(Schema.isMinLength(1)) });

export const linkedPrSchema = Schema.Struct({
  url: Schema.String,
  repository: Schema.String,
  number: Schema.Finite.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
  ).check(Schema.isGreaterThan(0)),
  title: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  reason: reasonSchema,
  linkedAt: Schema.Finite,
});

export const prSummarySchema = Schema.Struct(
  Struct.omit(linkedPrSchema.fields, ["reason", "linkedAt"]),
);

export const linkedDetailSchema = Schema.Struct({
  pr: prSummarySchema,
  body: Schema.String,
  headRefName: Schema.String,
  baseRefName: Schema.String,
  repositoryRoot: Schema.NullOr(Schema.String),
  baseRefOid: Schema.optionalKey(Schema.String),
  headRefOid: Schema.optionalKey(Schema.String),
  files: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        patch: Schema.NullOr(Schema.String),
        status: Schema.optionalKey(Schema.String),
        previousPath: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
});

export type LinkedPr = Schema.Schema.Type<typeof linkedPrSchema>;

export type LinkedDetail = Schema.Schema.Type<typeof linkedDetailSchema>;

export function parsePrUrl(value: string) {
  const url = new URL(value.trim());

  const match = url.pathname.match(
    /^\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)(?:\/(?:files|commits|checks))?\/?$/,
  );

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    !match
  )
    throw new Error("Enter a GitHub pull request URL: https://github.com/owner/repo/pull/123");
  const number = Number(match[3]);

  if (!Number.isSafeInteger(number)) throw new Error("Invalid pull request number");
  const repository = `${match[1]}/${match[2]}`.toLowerCase();

  return { url: `https://github.com/${repository}/pull/${number}`, repository, number };
}

export const linkedContentsInput = Schema.Struct({
  url: Schema.String,
  path: Schema.String.check(Schema.isMinLength(1)),
  oldPath: Schema.String.check(Schema.isMinLength(1)),
  base: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  head: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  changeType: Schema.Literals(["new", "deleted", "change", "rename-changed", "rename-pure"]),
});

export const linkedContentsSchema = Schema.Struct({
  oldContents: Schema.String,
  newContents: Schema.String,
});
