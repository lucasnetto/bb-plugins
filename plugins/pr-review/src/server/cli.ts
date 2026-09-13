import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { sync, fail, decodeSchema, type createRuntime } from "./server-effects";
import { reasonSchema } from "../shared/links-contract";
import type { registerLinks } from "./links-server";
import type { registerGuides } from "./guides-server";
import { parsePrReviewCommand } from "./cli-command";

export function registerPrReviewCli(
  bb: BbPluginApi,
  runtime: ReturnType<typeof createRuntime>,
  links: ReturnType<typeof registerLinks>,
  guides: ReturnType<typeof registerGuides>,
) {
  const cli = Effect.fn("PrReview.cli")(function* (
    argv: string[],
    ctx: { threadId?: string | null },
  ) {
    const input = parsePrReviewCommand(argv);

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
            "Usage: bb pr-review links | link <url> [reason] | unlink <url> | guide-context <url> | guide-save <url> <base> <head> '<JSON>'",
        };
      case "links":
        result = yield* links.linkedList({ threadId: yield* requireThread() });
        break;
      case "link":
        result = yield* links.linkedLink({
          threadId: yield* requireThread(),
          url: input.url,
          reason: yield* decodeSchema("link reason", reasonSchema)(input.reason),
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
      return yield* fail("Result exceeds bb's CLI output limit. Open the PR review panel.");

    return { exitCode: 0, stdout };
  });

  bb.cli.register({
    name: "pr-review",
    summary: "Link pull requests and manage guided reviews",
    commands: [
      {
        name: "guide-context",
        summary: "Get a linked PR's guided review context",
        usage: "bb pr-review guide-context <url>",
      },
      {
        name: "guide-save",
        summary: "Save a guided review",
        usage: "bb pr-review guide-save <url> <base> <head> '<JSON>'",
      },
      {
        name: "link",
        summary: "Link a PR to the current thread",
        usage: "bb pr-review link <url> <created-here|requested-review|requested-work|manual>",
      },
      {
        name: "unlink",
        summary: "Unlink a PR from the current thread",
        usage: "bb pr-review unlink <url>",
      },
      {
        name: "links",
        summary: "List the current thread’s linked PRs",
        usage: "bb pr-review links",
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
