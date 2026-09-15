import { opendir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** Inspect direct children; never guess between multiple workspace files. */
export async function resolveWorkspace(path: string): Promise<string | null> {
  if (!isAbsolute(path)) return null;
  try {
    const directory = await opendir(path);
    let workspace: string | null = null;
    let count = 0;
    for await (const entry of directory) {
      if (++count > 10000) return null;
      if (!entry.name.endsWith(".code-workspace")) continue;
      const candidate = join(path, entry.name);
      if (!entry.isFile() && !(entry.isSymbolicLink() && (await stat(candidate)).isFile()))
        continue;
      if (workspace !== null) return null;
      workspace = candidate;
    }
    return workspace;
  } catch {
    return null;
  }
}
