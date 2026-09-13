// BB adapter for T3 Code's PR code tab. Ported components retain T3-LICENSE.
import { useEffect } from "react";
import { Match } from "effect";
import { parsePatchFiles, type CodeViewDiffItem, type FileDiffContentsLoader } from "@pierre/diffs";
import type { LinkedDetail } from "../../shared/links-contract";

export function parseReviewFile(file: LinkedDetail["files"][number]): CodeViewDiffItem | null {
  if (!file.patch) return null;
  // JSON quoting is Git's path quoting convention, including spaces and tabs.
  const patch = `diff --git ${JSON.stringify(`a/${file.path}`)} ${JSON.stringify(`b/${file.path}`)}\n--- ${JSON.stringify(`a/${file.path}`)}\n+++ ${JSON.stringify(`b/${file.path}`)}\n${file.patch}\n`;

  try {
    const parsed = parsePatchFiles(patch)[0]?.files[0];

    if (!parsed) return null;
    parsed.name = file.path;

    if (file.previousPath) parsed.prevName = file.previousPath;
    parsed.type = Match.value(file.status).pipe(
      Match.when("added", () => "new" as const),
      Match.when("removed", () => "deleted" as const),
      Match.when("renamed", () => "rename-changed" as const),
      Match.orElse(() => "change" as const),
    );

    return { id: file.path, type: "diff", fileDiff: parsed };
  } catch {
    return null;
  }
}

// BB's bundled Pierre version expands full-file diffs but cannot hydrate a
// partial diff on click. Fetch only files whose virtualized header is mounted.
export function ContextHeader({
  item,
  load,
  children,
}: {
  item: CodeViewDiffItem;
  load: FileDiffContentsLoader;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (item.fileDiff.isPartial) void load(item.fileDiff).catch(() => {});
  }, [item.fileDiff, load]);

  return children;
}

/** Pierre only reconciles a record when its version changes. Reserve two bits
 * per refresh for full-context hydration and collapse state. The context reset
 * counter belongs in the record ID: changing it recreates file records while
 * preserving the root viewer, scroll observer, and worker subscriptions.
 */
export function diffRecordVersion(revision: number, hydrated: boolean, collapsed: boolean): number {
  const statesPerRevision = 4;
  const hydratedBit = hydrated ? 2 : 0;
  const collapsedBit = collapsed ? 1 : 0;

  return revision * statesPerRevision + hydratedBit + collapsedBit;
}
