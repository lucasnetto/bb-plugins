import { z } from "zod";
export { LINKS_CHANGED } from "./links-events";
export const reasonSchema = z.enum([
  "created-here",
  "requested-review",
  "requested-work",
  "manual",
]);
export const linkInput = z.object({ url: z.string(), reason: reasonSchema });
export const threadInput = z.object({ threadId: z.string().min(1) });
export const linkedPrSchema = z.object({
  url: z.string(),
  repository: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  reason: reasonSchema,
  linkedAt: z.number(),
});
export const prSummarySchema = linkedPrSchema.omit({ reason: true, linkedAt: true });
export const linkedDetailSchema = z.object({
  pr: prSummarySchema,
  body: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  repositoryRoot: z.string().nullable(),
  baseRefOid: z.string().optional(),
  headRefOid: z.string().optional(),
  files: z.array(
    z.object({
      path: z.string(),
      patch: z.string().nullable(),
      status: z.string().optional(),
      previousPath: z.string().optional(),
    }),
  ),
});
export type LinkedPr = z.infer<typeof linkedPrSchema>;
export type LinkedDetail = z.infer<typeof linkedDetailSchema>;
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

export const linkedContentsInput = z.object({
  url: z.string(),
  path: z.string().min(1),
  oldPath: z.string().min(1),
  base: z.string().regex(/^[a-f0-9]{40}$/),
  head: z.string().regex(/^[a-f0-9]{40}$/),
  changeType: z.enum(["new", "deleted", "change", "rename-changed", "rename-pure"]),
});
export const linkedContentsSchema = z.object({ oldContents: z.string(), newContents: z.string() });
