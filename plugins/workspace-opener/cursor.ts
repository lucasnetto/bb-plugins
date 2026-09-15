import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { resolveWorkspace } from "./resolve.ts";

const exec = promisify(execFile);

export function cursorArgs(input: {
  path: string;
  lineNumber?: number | null;
  columnNumber?: number | null;
}): string[] {
  if (!isAbsolute(input.path)) throw new Error("Cursor requires an absolute path");
  const args = ["--classic"];
  if (input.lineNumber != null) {
    args.push(
      "--goto",
      `${input.path}:${input.lineNumber}${input.columnNumber == null ? "" : `:${input.columnNumber}`}`,
    );
  } else {
    args.push(input.path);
  }
  return args;
}

export async function openCursor(input: Parameters<typeof cursorArgs>[0]) {
  const path =
    input.lineNumber == null ? ((await resolveWorkspace(input.path)) ?? input.path) : input.path;
  const args = cursorArgs({ ...input, path });
  const env = { ...process.env };
  // BB's host worker can inherit Electron/CLI variables from its launcher.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VSCODE_IPC_HOOK_CLI;
  delete env.NODE_OPTIONS;
  let executable = "cursor";
  if (process.platform === "darwin") {
    const roots = ["/Applications/Cursor.app", join(homedir(), "Applications/Cursor.app")];
    let found = false;
    for (const root of roots) {
      const candidate = join(root, "Contents/MacOS/Cursor");
      try {
        await access(candidate);
      } catch {
        continue;
      }
      executable = candidate;
      args.unshift(join(root, "Contents/Resources/app/out/cli.js"));
      env.ELECTRON_RUN_AS_NODE = "1";
      found = true;
      break;
    }
    if (!found) throw new Error("Cursor.app was not found in Applications");
  }
  await exec(executable, args, { env, timeout: 15000, maxBuffer: 256 * 1024 });
  return { opened: true as const };
}
