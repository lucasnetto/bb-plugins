import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { sync, fail, decodeSchema, type BackendError, type createRuntime } from "./server-effects";
import { reasonSchema } from "../shared/links-contract";
import type { registerLinks } from "./links-server";
import type { registerGuides } from "./guides-server";
import { parseMultirepoCommand } from "./cli-command";

type Operation<A extends readonly unknown[]> = (...args: A) => Effect.Effect<unknown, BackendError>;
interface WorkspaceCommands {
  discover: Operation<[]>;
  changes: Operation<[{ repo: string }]>;
  files: Operation<[{ repo: string }]>;
  prs: Operation<[{ repo: string }]>;
  detail: Operation<[{ repo: string; path: string; mode: "staged" | "worktree" }]>;
}

export function registerMultirepoCli(
  bb: BbPluginApi,
  runtime: ReturnType<typeof createRuntime>,
  operations: WorkspaceCommands,
  links: ReturnType<typeof registerLinks>,
  guides: ReturnType<typeof registerGuides>,
) {
  const cli = Effect.fn("Multirepo.cli")(function* (
    argv: string[],
    ctx: { threadId?: string | null },
  ) {
    const input = parseMultirepoCommand(argv);
    // Context validation belongs here; parsing is independent of a running BB thread.
    const requireThread = () =>
      ctx.threadId ? Effect.succeed(ctx.threadId) : fail("Run this command inside a BB thread.");
    let result: unknown;
    switch (input.command) {
      case "invalid":
        return yield* fail(input.message);
      case "help":
        return {
          exitCode: input.exitCode,
          stdout:
            "Usage: bb multirepo status | changes <repo> | files <repo> | prs <repo> | diff <repo> <path> [--staged] | links | link <url> [reason] | unlink <url> | guide-context <url> | guide-save <url> <base> <head> '<JSON>'",
        };
      case "status":
        result = yield* operations.discover();
        break;
      case "changes":
      case "files":
      case "prs":
        result = yield* operations[input.command]({ repo: input.repo });
        break;
      case "diff":
        result = yield* operations.detail({ repo: input.repo, path: input.path, mode: input.mode });
        break;
      case "links":
        result = yield* links.linkedList({ threadId: yield* requireThread() });
        break;
      case "link":
        result = yield* links.linkedLink({
          threadId: yield* requireThread(),
          url: input.url,
          reason: yield* decodeSchema("link reason", reasonSchema, input.reason),
        });
        break;
      case "unlink":
        result = yield* links.linkedUnlink({ threadId: yield* requireThread(), url: input.url });
        break;
      case "guide-context":
        return {
          exitCode: 0,
          stdout: yield* guides.guideContext({ threadId: yield* requireThread(), url: input.url }),
        };
      case "guide-save":
        result = yield* guides.guideSave({
          threadId: yield* requireThread(),
          url: input.url,
          base: input.base,
          head: input.head,
          guideJson: input.guideJson,
        });
        break;
    }
    const stdout = yield* sync("CLI output", () => JSON.stringify(result, null, 2));
    if (Buffer.byteLength(stdout) > PLUGIN_CLI_OUTPUT_MAX_BYTES)
      return yield* fail(
        "Result exceeds bb's CLI output limit. Use the Repos panel or a narrower file query.",
      );
    return { exitCode: 0, stdout };
  });

  bb.cli.register({
    name: "multirepo",
    summary: "Browse repositories in the configured workspace",
    commands: [
      {
        name: "guide-context",
        summary: "Get a linked PR's guided review context",
        usage: "bb multirepo guide-context <url>",
      },
      {
        name: "guide-save",
        summary: "Save a guided review",
        usage: "bb multirepo guide-save <url> <base> <head> '<JSON>'",
      },
      {
        name: "link",
        summary: "Link a PR to the current thread",
        usage: "bb multirepo link <url> <created-here|requested-review|requested-work|manual>",
      },
      {
        name: "unlink",
        summary: "Unlink a PR from the current thread",
        usage: "bb multirepo unlink <url>",
      },
      {
        name: "links",
        summary: "List the current thread’s linked PRs",
        usage: "bb multirepo links",
      },
      {
        name: "status",
        summary: "List repositories and change counts",
        usage: "bb multirepo status",
      },
      {
        name: "changes",
        summary: "List changed files",
        usage: "bb multirepo changes <repo>",
      },
      {
        name: "files",
        summary: "List repository files",
        usage: "bb multirepo files <repo>",
      },
      {
        name: "prs",
        summary: "List open pull requests",
        usage: "bb multirepo prs <repo>",
      },
      {
        name: "diff",
        summary: "Read a file diff",
        usage: "bb multirepo diff <repo> <path> [--staged]",
      },
    ],
    run: (argv, ctx) =>
      runtime.runPromise(
        cli(argv, ctx).pipe(
          Effect.catchTag("BackendError", (error) =>
            Effect.succeed({ exitCode: 1, stderr: error.message }),
          ),
        ),
      ),
  });
}
