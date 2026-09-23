import { useMemo } from "react";
import { DiffFileTree, type DiffFileTreeEntry } from "../ui/review/DiffFileTree";
import { collectDirectoryPaths } from "../ui/review/diffFileTree.logic";
import type { Change } from "./contract";

export function changeTreeEntry(change: Change): DiffFileTreeEntry {
  const status: DiffFileTreeEntry["status"] =
    change.area === "untracked"
      ? "untracked"
      : change.status === "A" || change.status === "C"
        ? "added"
        : change.status === "D"
          ? "deleted"
          : change.status === "R"
            ? "renamed"
            : "modified";

  return { path: change.path, status };
}

export function ChangeTree({
  changes,
  ariaLabel,
  selectedPath,
  onSelectFile,
}: {
  changes: Change[];
  ariaLabel: string;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}) {
  const entries = useMemo(() => changes.map(changeTreeEntry), [changes]);

  const rowCount =
    entries.length + collectDirectoryPaths(entries.map((entry) => entry.path)).length;

  return (
    <section aria-label={ariaLabel} className="pb-2">
      <div className="flex" style={{ height: Math.min(320, 40 + rowCount * 28) }}>
        <DiffFileTree
          entries={entries}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          ariaLabel={ariaLabel}
        />
      </div>
    </section>
  );
}
