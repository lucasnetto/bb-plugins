import { createHash } from "node:crypto";
import { mkdir, readdir, lstat, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { timed } from "./task-timing.ts";
import { checked } from "./task-process.ts";

export function normalizeRemote(remote: string): string {
  const ssh = /^git@github\.com:([^\s]+)$/.exec(remote);
  const url = new URL(
    ssh
      ? `https://github.com/${ssh[1]}`
      : remote.replace(/^ssh:\/\/git@github\.com\//, "https://github.com/"),
  );
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Orbisa checkout requires a credential-free HTTPS Git remote.");
  return url.href;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const queues = new Map<string, Promise<unknown>>();
async function locked<T>(cache: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(cache) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  queues.set(cache, next);
  try {
    return await next;
  } finally {
    if (queues.get(cache) === next) queues.delete(cache);
  }
}
export async function pruneGitCaches(root: string, signal: AbortSignal, now = Date.now()) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    signal.throwIfAborted();
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const cache = join(root, entry.name);
    if (queues.has(cache)) continue;
    await locked(cache, async () => {
      const dir = await lstat(cache);
      if (!dir.isDirectory() || dir.isSymbolicLink()) return;
      let used: number;
      try {
        used = Number(await readFile(join(cache, "last-used"), "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // Adopt only the known layout of caches created before retention existed.
        const mirror = await lstat(join(cache, "mirror.git")).catch(() => null);
        const bundle = await lstat(join(cache, "repository.bundle")).catch(() => null);
        if (mirror?.isDirectory() && bundle?.isFile())
          await writeFile(join(cache, "last-used"), String(now), { mode: 0o600 });
        return;
      }
      if (Number.isFinite(used) && used > 0 && now - used >= 30 * 24 * 60 * 60_000)
        await rm(cache, { recursive: true });
    });
  }
}
export async function withGitBundle<T>(
  root: string,
  remote: string,
  signal: AbortSignal,
  use: (bundle: string, defaultBranch: string) => Promise<T>,
  report: (text: string) => void = () => {},
): Promise<T> {
  const cache = join(root, hash(remote));
  const result = await locked(cache, async () => {
    signal.throwIfAborted();
    await mkdir(cache, { recursive: true, mode: 0o700 });
    const mirror = join(cache, "mirror.git");
    const git = (...args: string[]) =>
      checked(
        [
          "env",
          "GIT_TERMINAL_PROMPT=0",
          "git",
          "-c",
          "credential.helper=",
          "-c",
          "credential.helper=!gh auth git-credential",
          ...args,
        ],
        { signal, timeoutMs: 300_000 },
      );
    await writeFile(join(cache, "last-used"), String(Date.now()), { mode: 0o600 });
    const defaultBranch = await timed(report, "Git cache refresh", async () => {
      const refs = await git(
        "ls-remote",
        "--symref",
        remote,
        "HEAD",
        "refs/heads/*",
        "refs/tags/*",
      );
      const defaultBranch = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(refs)?.[1];
      if (!defaultBranch) throw new Error("The Git remote has no default branch.");
      const revision = hash(refs);
      const bundle = join(cache, "repository.bundle");
      let fresh = false;
      try {
        fresh =
          (await readFile(join(cache, "revision"), "utf8")) === revision &&
          (await stat(bundle)).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (!fresh) {
        let cloned = false;
        try {
          await stat(mirror);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          const staging = join(cache, "building.git");
          await rm(staging, { recursive: true, force: true });
          await git("clone", "--mirror", "--", remote, staging);
          await rename(staging, mirror);
          cloned = true;
        }
        if (!cloned)
          await git(
            "--git-dir",
            mirror,
            "fetch",
            "--prune",
            "origin",
            "+refs/heads/*:refs/heads/*",
            "+refs/tags/*:refs/tags/*",
          );
        await git("--git-dir", mirror, "symbolic-ref", "HEAD", `refs/heads/${defaultBranch}`);
        const pending = join(cache, "repository.pending.bundle");
        await rm(pending, { force: true });
        await git("--git-dir", mirror, "bundle", "create", pending, "--branches", "--tags", "HEAD");
        await rename(pending, bundle);
        await writeFile(join(cache, "revision"), revision, { mode: 0o600 });
      }
      return defaultBranch;
    });
    // Hold the lock until transfer completes so updates cannot replace its input.
    return timed(report, "Git transfer and checkout", () =>
      use(join(cache, "repository.bundle"), defaultBranch),
    );
  });
  return result;
}
