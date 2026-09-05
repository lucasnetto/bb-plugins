import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readdir, realpath, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { prSchema, type Change, type Repo } from "./contract";
const exec = promisify(execFile);
// A host RPC result is limited to 8 MiB. Reserve half for JSON escaping and metadata.
const MAX_BYTES = 4 * 1024 * 1024;
export async function command(
  cwd: string,
  program: string,
  args: string[],
  signal?: AbortSignal,
) {
  const { stdout } = await exec(program, args, {
    cwd,
    signal,
    encoding: "utf8",
    maxBuffer: MAX_BYTES,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
    },
  });
  return stdout;
}
const git = (cwd: string, args: string[], signal?: AbortSignal) =>
  command(cwd, "git", ["--no-pager", "--literal-pathspecs", ...args], signal);
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}
export async function repository(root: string, repo: string) {
  const base = await realpath(root);
  if (isAbsolute(repo) || repo.split(/[\\/]/).includes(".."))
    throw new Error("Invalid repository path");
  const path = await realpath(resolve(base, repo));
  if (!inside(base, path))
    throw new Error("Repository is outside the workspace");
  await lstat(join(path, ".git"));
  return path;
}
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
export async function changes(path: string, signal?: AbortSignal) {
  return parseStatus(
    await git(
      path,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      signal,
    ),
  );
}
export function githubRemote(value: string): string | null {
  const match = value
    .trim()
    .match(
      /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
    );
  return match?.[1] ?? null;
}
async function remote(path: string, signal?: AbortSignal) {
  return githubRemote(
    await git(path, ["remote", "get-url", "origin"], signal).catch(() => ""),
  );
}
export async function discover(
  root: string,
  signal?: AbortSignal,
): Promise<Repo[]> {
  const base = await realpath(root);
  const result: Repo[] = [];
  async function visit(path: string) {
    signal?.throwIfAborted();
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.some((e) => e.name === ".git")) {
      const name = relative(base, path) || ".";
      try {
        const [status, branch, origin] = await Promise.all([
          changes(path, signal),
          git(path, ["branch", "--show-current"], signal),
          remote(path, signal),
        ]);
        result.push({
          name,
          branch: branch.trim() || "Detached HEAD",
          remote: origin,
          changes: status.length,
          error: null,
        });
      } catch (e) {
        result.push({
          name,
          branch: "",
          remote: null,
          changes: 0,
          error: String(e),
        });
      }
      return;
    }
    // Repository roots end discovery; ignored build/dependency directories and symlinks are not workspace containers.
    for (const e of entries)
      if (
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        !["node_modules", "vendor", "target", "dist", "build"].includes(e.name)
      )
        await visit(join(path, e.name));
  }
  await visit(base);
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
export async function files(path: string, signal?: AbortSignal) {
  return [
    ...new Set(
      (
        await git(
          path,
          ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
          signal,
        )
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
}
export async function detail(
  repoPath: string,
  path: string,
  mode: "staged" | "worktree" | "source",
  signal?: AbortSignal,
) {
  repoPath = await realpath(repoPath);
  if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
    throw new Error("Invalid file path");
  if (mode !== "source") {
    const patch = await git(
      repoPath,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        ...(mode === "staged" ? ["--cached"] : []),
        "--",
        path,
      ],
      signal,
    );
    return {
      path,
      patch,
      content: null,
      notice: patch
        ? null
        : "No diff in this view. Untracked files can be opened as source.",
    };
  }
  const target = await realpath(join(repoPath, path));
  if (!inside(repoPath, target))
    throw new Error("File resolves outside the repository");
  const stat = await lstat(target);
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
      notice:
        "File exceeds the host preview transport limit. Open it in your editor.",
    };
  const buffer = await readFile(target, { signal });
  return {
    path,
    patch: null,
    content: buffer.includes(0) ? null : buffer.toString("utf8"),
    notice: buffer.includes(0) ? "Binary file. Open it in your editor." : null,
  };
}
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
async function ghRepo(path: string, signal?: AbortSignal) {
  const r = await remote(path, signal);
  if (!r) throw new Error("No github.com origin remote for this repository");
  return r;
}
export async function prs(path: string, signal?: AbortSignal) {
  const r = await ghRepo(path, signal);
  const pages = JSON.parse(
    await command(
      path,
      "gh",
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${r}/pulls?state=open&per_page=100`,
      ],
      signal,
    ),
  );
  return z.array(z.array(apiPr)).parse(pages).flat().map(normalizePr);
}
export async function prFiles(
  path: string,
  number: number,
  signal?: AbortSignal,
) {
  const r = await ghRepo(path, signal);
  const pages = JSON.parse(
    await command(
      path,
      "gh",
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${r}/pulls/${number}/files?per_page=100`,
      ],
      signal,
    ),
  );
  return z
    .array(
      z.array(
        z.object({
          filename: z.string(),
          status: z.string(),
          patch: z.string().optional(),
        }),
      ),
    )
    .parse(pages)
    .flat()
    .map((f) => ({
      path: f.filename,
      status: f.status,
      patch: f.patch ?? null,
    }));
}
export async function reviewTarget(
  path: string,
  number: number,
  signal?: AbortSignal,
) {
  const r = await ghRepo(path, signal);
  const pr = normalizePr(
    apiPr.parse(
      JSON.parse(
        await command(
          path,
          "gh",
          ["api", `repos/${r}/pulls/${number}`],
          signal,
        ),
      ),
    ),
  );
  return { path, remote: r, pr };
}
