import { execFile } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, join, relative, isAbsolute } from "node:path";
import type { Change, Checkout, CheckoutDiff, DiffTarget, LocalDiff, Snapshot } from "./contract";

const MAX_FILES = 2000;

const MAX_CHECKOUTS = 150;

const skip = new Set(["node_modules", "vendor", "dist", "build", "target"]);

// Snapshot scans refresh this host-local membership list. Diff reads still read Git afresh.
const knownCheckouts = new Map<string, { paths: Set<string>; expires: number }>();

function git(root: string, args: string[], signal?: AbortSignal, allowDifference = false) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      [
        "--no-optional-locks",
        "--literal-pathspecs",
        "-c",
        "core.quotePath=false",
        "-C",
        root,
        ...args,
      ],
      {
        signal,
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (!error || (allowDifference && error.code === 1)) resolve(stdout);
        else reject(new Error(stderr.trim() || error.message));
      },
    );
  });
}

export function parseStatus(raw: string): Change[] {
  const records = raw.split("\0");
  const changes: Change[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (!record) continue;
    const status = record.slice(0, 2);
    const path = record.slice(3);
    const previousPath = /[RC]/.test(status) ? records[++i] : undefined;

    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status)) {
      changes.push({ path, status, area: "conflict" });
    } else if (status === "??") {
      changes.push({ path, status: "?", area: "untracked" });
    } else {
      if (status[0] !== " " && status[0] !== "!")
        changes.push({ path, previousPath, status: status[0], area: "staged" });

      if (status[1] !== " " && status[1] !== "!")
        changes.push({ path, previousPath, status: status[1], area: "unstaged" });
    }
  }

  return changes;
}

export function parseWorktrees(raw: string) {
  const rows: { path: string; branch: string }[] = [];

  for (const record of raw.split("\0\0")) {
    const fields = record.split("\0");
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);

    if (!path || fields.includes("bare")) continue;

    const branch =
      fields
        .find((field) => field.startsWith("branch "))
        ?.slice(7)
        .replace(/^refs\/heads\//, "") ?? "Detached HEAD";

    rows.push({ path, branch });
  }

  return rows;
}

async function discover(root: string, signal?: AbortSignal) {
  const canonicalRoot = await realpath(root);
  const warnings: string[] = [];
  const repositories: string[] = [];
  const queue = [{ path: canonicalRoot, depth: 0 }];

  // A thread may point at a subdirectory within an ordinary checkout or worktree.
  try {
    const top = (await git(canonicalRoot, ["rev-parse", "--show-toplevel"], signal)).trim();
    repositories.push(top);
    queue.length = 0;
  } catch {
    signal?.throwIfAborted();
  }

  let visited = 0;

  while (queue.length && visited++ < 500 && repositories.length < 100) {
    signal?.throwIfAborted();
    const item = queue.shift()!;

    try {
      const entries = await readdir(item.path, { withFileTypes: true });

      if (entries.some((entry) => entry.name === ".git")) {
        repositories.push(item.path);
        continue;
      }

      const children = entries.filter(
        (entry) => entry.isDirectory() && !entry.name.startsWith(".") && !skip.has(entry.name),
      );

      if (item.depth >= 3) {
        if (children.length)
          warnings.push(`Repository discovery stopped at ${item.path} (depth limit).`);
        continue;
      }

      for (const entry of children)
        queue.push({ path: join(item.path, entry.name), depth: item.depth + 1 });
    } catch (error) {
      warnings.push(`${item.path}: ${String(error)}`);
    }
  }

  if (queue.length)
    warnings.push(
      "Repository discovery reached its limit; open a more specific directory to see the rest.",
    );
  const found = new Map<string, Omit<Checkout, "changes" | "error">>();

  for (const repo of repositories) {
    try {
      const rows = parseWorktrees(
        await git(repo, ["worktree", "list", "--porcelain", "-z"], signal),
      );

      const name = basename(rows[0]?.path ?? repo);

      for (const row of rows) {
        if (found.size >= MAX_CHECKOUTS) {
          warnings.push("Only the first 150 checkouts are shown.");
          break;
        }

        let path: string;

        try {
          path = await realpath(row.path);
        } catch {
          warnings.push(`Worktree is unavailable: ${row.path}`);
          continue;
        }

        const fromCheckout = relative(path, canonicalRoot);

        const current =
          fromCheckout === "" || (!fromCheckout.startsWith("..") && !isAbsolute(fromCheckout));

        found.set(path, { ...row, path, repository: name, current });
      }
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push(`${repo}: ${String(error)}`);
    }
  }

  signal?.throwIfAborted();
  knownCheckouts.delete(canonicalRoot);
  knownCheckouts.set(canonicalRoot, { paths: new Set(found.keys()), expires: Date.now() + 30000 });

  while (knownCheckouts.size > 16) knownCheckouts.delete(knownCheckouts.keys().next().value!);

  return { root: canonicalRoot, checkouts: [...found.values()], warnings };
}

async function validateCheckout(root: string, checkout: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const canonicalRoot = await realpath(root);
  const canonicalCheckout = await realpath(checkout);
  const known = knownCheckouts.get(canonicalRoot);

  if (
    canonicalCheckout === checkout &&
    known &&
    known.expires > Date.now() &&
    known.paths.has(checkout)
  )
    return;

  // Unknown paths trigger discovery so a newly registered worktree is available immediately.
  const discovered = await discover(canonicalRoot, signal);

  if (!discovered.checkouts.some((entry) => entry.path === checkout))
    throw new Error("This checkout no longer belongs to the thread directory.");
}

async function status(path: string, signal?: AbortSignal) {
  return parseStatus(
    await git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], signal),
  );
}

export async function localSnapshot(root: string, signal?: AbortSignal): Promise<Snapshot> {
  const result = await discover(root, signal);
  const checkouts: Checkout[] = [];
  let remaining = MAX_FILES;

  for (const checkout of result.checkouts) {
    try {
      const changes = await status(checkout.path, signal);
      const displayed = changes.slice(0, remaining);
      remaining -= displayed.length;
      checkouts.push({
        ...checkout,
        changes: displayed,
        error:
          changes.length > displayed.length
            ? "File limit reached; open this checkout directly to see more."
            : null,
      });
    } catch (error) {
      signal?.throwIfAborted();
      checkouts.push({ ...checkout, changes: [], error: String(error) });
    }
  }

  return { ...result, checkouts };
}

export async function localDiff(
  root: string,
  target: DiffTarget,
  signal?: AbortSignal,
): Promise<LocalDiff> {
  // Resolve membership on the host; the browser cannot request an arbitrary checkout or file.
  await validateCheckout(root, target.checkout, signal);
  const changes = await status(target.checkout, signal);

  const change = changes.find(
    (entry) =>
      entry.path === target.path && (target.area === "combined" || entry.area === target.area),
  );

  if (!change) return { patch: "", notice: "This file no longer has changes in this section." };

  return readChangeDiff(
    target.checkout,
    change,
    target.area === "combined" ? await combinedRevision(target.checkout, signal) : undefined,
    signal,
  );
}

async function combinedRevision(path: string, signal?: AbortSignal) {
  try {
    return [(await git(path, ["rev-parse", "--verify", "HEAD"], signal)).trim()];
  } catch {
    signal?.throwIfAborted();

    return [(await git(path, ["hash-object", "-t", "tree", "/dev/null"], signal)).trim()];
  }
}

async function readChangeDiff(
  checkoutPath: string,
  change: Change,
  combined: string[] | undefined,
  signal?: AbortSignal,
): Promise<LocalDiff> {
  if (change.area === "conflict")
    return {
      patch: "",
      notice:
        "This file has unresolved merge conflicts. Resolve them in your editor to view its diff.",
    };
  let patch: string;

  if (change.area === "untracked") {
    const path = join(checkoutPath, change.path);
    const info = await lstat(path);

    if (!info.isFile() && !info.isSymbolicLink())
      return { patch: "", notice: "This entry is not a regular file." };

    if (info.size > 1024 * 1024)
      return { patch: "", notice: "This file is too large to preview (1 MiB limit)." };
    patch = await git(
      checkoutPath,
      ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--", "/dev/null", change.path],
      signal,
      true,
    );
  } else {
    const revision = combined ?? (change.area === "staged" ? ["--cached"] : []);

    patch = await git(
      checkoutPath,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        ...revision,
        "--",
        change.path,
        ...(change.previousPath ? [change.previousPath] : []),
      ],
      signal,
    );
  }

  if (Buffer.byteLength(patch) > 1024 * 1024)
    return { patch: "", notice: "This diff is too large to preview (1 MiB limit)." };

  if (/^Binary files .* differ$/m.test(patch))
    return { patch: "", notice: "Binary file changed; no text preview is available." };

  return { patch, notice: patch ? null : "No text diff is available for this change." };
}

/** Reuse recent discovery, then read this checkout with bounded parallel Git reads. */
export async function localCheckoutDiff(
  root: string,
  checkoutPath: string,
  signal?: AbortSignal,
): Promise<CheckoutDiff> {
  await validateCheckout(root, checkoutPath, signal);

  const changes = [
    ...new Map(
      (await status(checkoutPath, signal)).map((change) => [change.path, change]),
    ).values(),
  ].slice(0, MAX_FILES);

  const revision = await combinedRevision(checkoutPath, signal);
  const result: CheckoutDiff = [];
  let bytes = 0;

  for (let i = 0; i < changes.length; i += 4) {
    signal?.throwIfAborted();

    const group = await Promise.all(
      changes.slice(i, i + 4).map(async (change) => {
        if (bytes >= 4 * 1024 * 1024)
          return {
            path: change.path,
            patch: "",
            notice: "Checkout preview limit reached (4 MiB).",
          };

        try {
          return {
            path: change.path,
            ...(await readChangeDiff(checkoutPath, change, revision, signal)),
          };
        } catch (cause) {
          signal?.throwIfAborted();

          return { path: change.path, patch: "", notice: String(cause) };
        }
      }),
    );

    for (const file of group) {
      bytes += Buffer.byteLength(JSON.stringify(file));
      result.push(
        bytes <= 4 * 1024 * 1024
          ? file
          : { path: file.path, patch: "", notice: "Checkout preview limit reached (4 MiB)." },
      );
    }
  }

  return result;
}
