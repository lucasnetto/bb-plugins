// Adapted from T3 Code. See T3-LICENSE.
import type { FileTree, FileTreeDirectoryHandle, FileTreeItemHandle } from "@pierre/trees";

export type FileTreeExpansionModel = Pick<FileTree, "getItem">;

function asDirectoryHandle(item: FileTreeItemHandle | null): FileTreeDirectoryHandle | null {
  if (item === null || !item.isDirectory() || !("expand" in item)) {
    return null;
  }

  return item;
}

export function areAllDirectoriesExpanded(
  model: FileTreeExpansionModel,
  directoryPaths: readonly string[],
): boolean {
  return (
    directoryPaths.length > 0 &&
    directoryPaths.every((path) => {
      const item = asDirectoryHandle(model.getItem(path));

      return item !== null && item.isExpanded();
    })
  );
}

export function setAllDirectoriesExpanded(
  model: FileTreeExpansionModel,
  directoryPaths: readonly string[],
  expanded: boolean,
): void {
  for (const path of directoryPaths) {
    const item = asDirectoryHandle(model.getItem(path));

    if (item === null || item.isExpanded() === expanded) continue;

    if (expanded) item.expand();
    else item.collapse();
  }
}
