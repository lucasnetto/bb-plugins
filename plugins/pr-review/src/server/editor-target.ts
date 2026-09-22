import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { matchingCheckout } from "./checkout";
import { command, invalid } from "./host-effects";

/** NUL output preserves spaces, newlines, and non-ASCII worktree paths. */
export function parseWorktrees(output: string) {
  return output.split("\0\0").flatMap((record) => {
    const fields = record.split("\0");
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    if (!path || fields.some((field) => field === "bare" || field.startsWith("prunable")))
      return [];
    return [{ path, branch: fields.find((field) => field.startsWith("branch "))?.slice(7) }];
  });
}

const directory = (path: string) =>
  Effect.promise(async () => (await stat(path).catch(() => null))?.isDirectory() ?? false);

export const editorTarget = Effect.fn("PrWorkspace.editorTarget")(function* (
  roots: string[],
  repository: string,
  branch: string,
) {
  for (const root of [...new Set(roots)]) {
    // Group projects may contain repositories directly beneath their source folder.
    // Never recursively crawl a machine or infer a path from a GitHub branch name.
    const direct = yield* matchingCheckout(root, repository);
    const candidates = direct
      ? [direct]
      : yield* Effect.promise(async () =>
          (await readdir(root, { withFileTypes: true }).catch(() => []))
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
            .map((entry) => join(root, entry.name)),
        );
    for (const candidate of candidates) {
      const checkout = direct ?? (yield* matchingCheckout(candidate, repository));
      if (!checkout) continue;
      const output = yield* command(checkout, "git", ["worktree", "list", "--porcelain", "-z"]);
      const worktrees = parseWorktrees(output);
      for (const tree of worktrees.filter((tree) => tree.branch === `refs/heads/${branch}`)) {
        if (yield* directory(tree.path)) return tree.path;
      }
      const main = worktrees[0];
      if (main && (yield* directory(main.path))) return main.path;
      if (yield* directory(checkout)) return checkout;
    }
  }
  return yield* invalid("No local checkout was found for this pull request on this machine.");
});
