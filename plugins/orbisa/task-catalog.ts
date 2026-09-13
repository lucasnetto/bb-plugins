import { concurrently, CATALOG_CONCURRENCY } from "./task-concurrency.ts";
import { errorCodeSchema } from "./task-boundaries.ts";
import { readdir, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { checked, command } from "./task-process.ts";
import { normalizeRemote } from "./task-git-cache.ts";

export interface CatalogRepository {
  source: string;
  relative: string;
  remote: string;
}

export async function discoverCatalog(
  root: string,
  signal: AbortSignal,
): Promise<CatalogRepository[]> {
  const candidates: string[] = [];

  async function walk(path: string) {
    signal.throwIfAborted();

    try {
      const git = await lstat(join(path, ".git"));

      if (git.isDirectory()) candidates.push(path);

      return; // Skip linked worktrees and never descend inside a repository.
    } catch (error) {
      if (errorCodeSchema.safeParse(error).data?.code !== "ENOENT") throw error;
    }

    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
        await walk(join(path, entry.name));
    }
  }

  await walk(root);

  const repositories = await concurrently(
    candidates.sort(),
    CATALOG_CONCURRENCY,
    signal,
    async (source, signal) => {
      const path = relative(root, source);

      if (!path || !path.split("/").every((p) => /^[A-Za-z0-9._-]+$/.test(p) && p !== ".."))
        throw new Error("Invalid catalog repository path.");

      const origin = await command(["git", "-C", source, "remote", "get-url", "origin"], {
        signal,
      });

      const remote = origin.exitCode === 0 ? normalizeRemote(origin.stdout.trim()) : "";

      return { source, relative: path, remote };
    },
  );

  const seen = new Set<string>();

  const found = repositories.filter((repository) => {
    const identity = repository.remote || repository.source;

    if (seen.has(identity)) return false;
    seen.add(identity);

    return true;
  });

  await concurrently(found, CATALOG_CONCURRENCY, signal, async ({ source }, signal) => {
    await checked(["git", "-C", source, "symbolic-ref", "HEAD"], { signal });
  });

  if (!found.length) throw new Error("The workspace contains no seedable Git repositories.");

  return found;
}
