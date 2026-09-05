import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export async function pullCleanDefaultBranch(
  path: string,
  signal?: AbortSignal,
) {
  const git = async (...args: string[]) =>
    (
      await exec("git", args, {
        cwd: path,
        signal,
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      })
    ).stdout.trim();
  // Stay on the checkout's configured remote default; never switch branches.
  const branch = await git("symbolic-ref", "--quiet", "HEAD").catch(() => "");
  if (!branch) return { pulled: false };
  const upstream = await git(
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ).catch(() => "");
  if (!upstream) return { pulled: false };
  const remote = await git(
    "config",
    "--get",
    `branch.${branch.replace(/^refs\/heads\//, "")}.remote`,
  );
  if (!remote || remote === ".") return { pulled: false };
  const remoteHead = await git(
    "symbolic-ref",
    "--quiet",
    `refs/remotes/${remote}/HEAD`,
  ).catch(() => "");
  if (!remoteHead) return { pulled: false };
  if (
    `refs/remotes/${upstream}` !== remoteHead ||
    branch.replace("refs/heads/", "") !==
      remoteHead.replace(`refs/remotes/${remote}/`, "")
  )
    return { pulled: false };
  if (await git("status", "--porcelain")) return { pulled: false };
  if ((await git("rev-list", "--count", "@{upstream}..HEAD")) !== "0")
    return { pulled: false };
  await git("fetch", "--no-tags", "--", remote);
  if (await git("status", "--porcelain")) return { pulled: false };
  if ((await git("symbolic-ref", "--quiet", "HEAD")) !== branch)
    return { pulled: false };
  if ((await git("rev-list", "--count", "@{upstream}..HEAD")) !== "0")
    return { pulled: false };
  await git("merge", "--ff-only", "--", upstream);
  return { pulled: true };
}
