import { lstat, readdir, realpath, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { Effect, Layer } from "effect";
import { DiscoveryError, DiscoveryIO, discoverRepositories } from "./discovery";
import {
  Commands,
  command,
  fileRead,
  decode,
  invalid,
  hasExitCode,
  MAX_BYTES,
} from "./host-effects";
import { prSchema, type Change } from "../shared/contract";
const git = (cwd: string, args: string[]) =>
  command(cwd, "git", ["--no-pager", "--literal-pathspecs", ...args]);
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
export const repository = Effect.fn("Git.repository")(function* (root: string, repo: string) {
  const base = yield* fileRead("realpath", () => realpath(root));
  if (isAbsolute(repo) || repo.split(/[\\/]/).includes(".."))
    return yield* invalid("Invalid repository path");
  const path = yield* fileRead("realpath", () => realpath(resolve(base, repo)));
  if (!inside(base, path)) return yield* invalid("Repository is outside the workspace");
  yield* fileRead("lstat", () => lstat(join(path, ".git")));
  return path;
});
export function parseStatus(raw: string): Change[] {
  const entries = raw.split("\0");
  const result: Change[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const index = entry[0],
      worktree = entry[1],
      path = entry.slice(3);
    const oldPath = /[RC]/.test(index + worktree) ? entries[++i] : null;
    result.push({ path, oldPath: oldPath ?? null, index, worktree });
  }
  return result;
}
export const changes = Effect.fn("Git.changes")(function* (path: string) {
  return parseStatus(yield* git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
});
export function githubRemote(value: string): string | null {
  const match = value
    .trim()
    .match(
      /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
    );
  return match?.[1] ?? null;
}
const remote = Effect.fn("Git.remote")(function* (path: string) {
  const url = yield* git(path, ["remote", "get-url", "origin"]).pipe(
    Effect.catchTag("CommandError", (error) =>
      hasExitCode(error, 2) ? Effect.succeed("") : Effect.fail(error),
    ),
  );
  return githubRemote(url);
});
const discoveryLayer = Layer.effect(
  DiscoveryIO,
  Effect.gen(function* () {
    const commands = yield* Commands;
    const mapError = (operation: string, path: string) =>
      Effect.mapError(
        (cause: { message: string }) =>
          new DiscoveryError({ path, operation, message: cause.message, cause }),
      );
    return DiscoveryIO.of({
      realpath: (path) =>
        fileRead("realpath", () => realpath(path)).pipe(mapError("realpath", path)),
      entries: (path) =>
        fileRead("readdir", () => readdir(path, { withFileTypes: true })).pipe(
          mapError("readdir", path),
        ),
      snapshot: Effect.fn("DiscoveryIO.snapshot")((path: string) =>
        Effect.all(
          {
            changes: changes(path).pipe(Effect.map((status) => status.length)),
            branch: git(path, ["branch", "--show-current"]).pipe(
              Effect.map((branch) => branch.trim() || "Detached HEAD"),
            ),
            remote: remote(path),
          },
          { concurrency: 3 },
        ).pipe(Effect.provideService(Commands, commands), mapError("git snapshot", path)),
      ),
    });
  }),
);
export const discover = Effect.fn("Git.discover")((root: string) =>
  discoverRepositories(root).pipe(Effect.provide(discoveryLayer)),
);
export const files = Effect.fn("Git.files")(function* (path: string) {
  return [
    ...new Set(
      (yield* git(path, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
});
export const detail = Effect.fn("Git.detail")(function* (
  repoPath: string,
  path: string,
  mode: "staged" | "worktree" | "source",
) {
  repoPath = yield* fileRead("realpath", () => realpath(repoPath));
  if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
    return yield* invalid("Invalid file path");
  if (mode !== "source") {
    const patch = yield* git(repoPath, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      ...(mode === "staged" ? ["--cached"] : []),
      "--",
      path,
    ]);
    return {
      path,
      patch,
      content: null,
      notice: patch ? null : "No diff in this view. Untracked files can be opened as source.",
    };
  }
  const target = yield* fileRead("realpath", () => realpath(join(repoPath, path)));
  if (!inside(repoPath, target)) return yield* invalid("File resolves outside the repository");
  const stat = yield* fileRead("lstat", () => lstat(target));
  if (!stat.isFile())
    return {
      path,
      patch: null,
      content: null,
      notice: "This entry is not a regular file.",
    };
  if (stat.size > MAX_BYTES)
    return {
      path,
      patch: null,
      content: null,
      notice: "File exceeds the host preview transport limit. Open it in your editor.",
    };
  const buffer = yield* fileRead("readFile", (signal) => readFile(target, { signal }));
  return {
    path,
    patch: null,
    content: buffer.includes(0) ? null : buffer.toString("utf8"),
    notice: buffer.includes(0) ? "Binary file. Open it in your editor." : null,
  };
});
const apiPr = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  head: z.object({ ref: z.string() }),
  base: z.object({ ref: z.string() }),
  draft: z.boolean(),
  user: z.object({ login: z.string() }).nullable(),
});
function normalizePr(pr: z.infer<typeof apiPr>) {
  return prSchema.parse({
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    headRefName: pr.head.ref,
    baseRefName: pr.base.ref,
    isDraft: pr.draft,
    author: pr.user?.login ?? "unknown",
  });
}
const ghRepo = Effect.fn("Git.githubRepository")(function* (path: string) {
  const r = yield* remote(path);
  if (!r) return yield* invalid("No github.com origin remote for this repository");
  return r;
});
export const prs = Effect.fn("Git.prs")(function* (path: string) {
  const r = yield* ghRepo(path);
  const raw = yield* command(path, "gh", [
    "api",
    "--paginate",
    "--slurp",
    `repos/${r}/pulls?state=open&per_page=100`,
  ]);
  return yield* decode(() =>
    z.array(z.array(apiPr)).parse(JSON.parse(raw)).flat().map(normalizePr),
  );
});
export const prFiles = Effect.fn("Git.prFiles")(function* (path: string, number: number) {
  const r = yield* ghRepo(path);
  const raw = yield* command(path, "gh", [
    "api",
    "--paginate",
    "--slurp",
    `repos/${r}/pulls/${number}/files?per_page=100`,
  ]);
  return yield* decode(() =>
    z
      .array(
        z.array(
          z.object({
            filename: z.string(),
            status: z.string(),
            patch: z.string().optional(),
          }),
        ),
      )
      .parse(JSON.parse(raw))
      .flat()
      .map((f) => ({
        path: f.filename,
        status: f.status,
        patch: f.patch ?? null,
      })),
  );
});
export const reviewTarget = Effect.fn("Git.reviewTarget")(function* (path: string, number: number) {
  const r = yield* ghRepo(path);
  const raw = yield* command(path, "gh", ["api", `repos/${r}/pulls/${number}`]);
  const pr = yield* decode(() => normalizePr(apiPr.parse(JSON.parse(raw))));
  return { path, remote: r, pr };
});
