import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
export async function withGitBundle<T>(
  root: string,
  remote: string,
  signal: AbortSignal,
  use: (bundle: string, defaultBranch: string) => Promise<T>,
): Promise<T> {
  const key = hash(remote);
  const cache = join(root, key);
  const previous = queues.get(cache) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
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
        try {
          await stat(mirror);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          const staging = join(cache, "building.git");
          await rm(staging, { recursive: true, force: true });
          await git("clone", "--mirror", "--", remote, staging);
          await rename(staging, mirror);
        }
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
      // Hold the lock until transfer completes so updates cannot replace its input.
      return use(bundle, defaultBranch);
    });
  queues.set(cache, next);
  try {
    return await next;
  } finally {
    if (queues.get(cache) === next) queues.delete(cache);
  }
}
