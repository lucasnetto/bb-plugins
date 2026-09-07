/** Positional arguments acquire domain names at the CLI boundary. */
export type MultirepoCommand =
  | { command: "help"; exitCode: number }
  | { command: "invalid"; message: string }
  | { command: "status" | "links" }
  | { command: "changes" | "files" | "prs"; repo: string }
  | { command: "diff"; repo: string; path: string; mode: "staged" | "worktree" }
  | { command: "link"; url: string; reason: string }
  | { command: "unlink" | "guide-context"; url: string }
  | { command: "guide-save"; url: string; base: string; head: string; guideJson: string };

export function parseMultirepoCommand(argv: readonly string[]): MultirepoCommand {
  const [command, ...args] = argv.filter((arg) => arg !== "--json");
  switch (command) {
    case undefined:
    case "--help":
      return { command: "help", exitCode: 0 };
    case "status":
    case "links":
      return { command };
    case "changes":
    case "files":
    case "prs": {
      const [repo] = args;
      return repo ? { command, repo } : { command: "help", exitCode: 1 };
    }
    case "diff": {
      const [repo, path, flag] = args;
      return repo && path
        ? { command, repo, path, mode: flag === "--staged" ? "staged" : "worktree" }
        : { command: "help", exitCode: 1 };
    }
    case "link":
    case "unlink":
    case "guide-context": {
      const [url, reason = "manual"] = args;
      if (!url) return { command: "invalid", message: "A pull request URL is required." };
      return command === "link" ? { command, url, reason } : { command, url };
    }
    case "guide-save": {
      const [url, base, head, guideJson] = args;
      return url && base && head && guideJson
        ? { command, url, base, head, guideJson }
        : {
            command: "invalid",
            message: "Usage: bb multirepo guide-save <url> <base> <head> '<JSON>'",
          };
    }
    default:
      return { command: "help", exitCode: 1 };
  }
}
