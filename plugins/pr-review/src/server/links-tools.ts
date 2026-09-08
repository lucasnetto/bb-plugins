import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { Effect } from "effect";
import { sync, type createRuntime } from "./server-effects";
import { reasonSchema } from "../shared/links-contract";
import type { registerLinks } from "./links-server";

function toolResult(value: unknown) {
  const text = JSON.stringify(value);
  // Match BB's documented agent-facing CLI transport ceiling.
  if (Buffer.byteLength(text) > PLUGIN_CLI_OUTPUT_MAX_BYTES)
    throw new Error(
      "Too many linked PRs to return through the agent transport. Open the Linked PRs panel.",
    );
  return text;
}
export function registerLinkTools(
  bb: BbPluginApi,
  runtime: ReturnType<typeof createRuntime>,
  handlers: Pick<ReturnType<typeof registerLinks>, "linkedLink" | "linkedUnlink" | "linkedList">,
) {
  // The SDK requires Zod for validated agent-tool parameters. RPC uses Standard Schema.
  bb.agents.registerTool({
    name: "link_pull_request",
    description:
      "Link a GitHub pull request to the current BB thread. Supports several repositories and PRs. Does not post to GitHub.",
    instructions:
      "Call link_pull_request after successfully creating a PR, when the user asks you to review or work on a PR, or explicitly asks to link one. Use created-here, requested-review, requested-work, or manual as the reason. Do not link PRs mentioned only as examples or background. Preserve existing links. Use unlink_pull_request when asked to remove a link; list_linked_pull_requests shows current links. If these tools are unavailable in an existing session, use bb pr-review link <url> <reason>, unlink <url>, or links in the current thread.",
    parameters: z.object({ url: z.string(), reason: z.enum(reasonSchema.literals) }),
    execute: (input, ctx) =>
      runtime.runPromise(
        handlers
          .linkedLink({ ...input, threadId: ctx.threadId })
          .pipe(Effect.flatMap((value) => sync("tool result", () => toolResult(value)))),
        { signal: ctx.signal },
      ),
  });
  bb.agents.registerTool({
    name: "unlink_pull_request",
    description:
      "Remove one PR link from the current BB thread. Does not close or change the PR on GitHub.",
    parameters: z.object({ url: z.string() }),
    execute: (input, ctx) =>
      runtime.runPromise(
        handlers
          .linkedUnlink({ ...input, threadId: ctx.threadId })
          .pipe(Effect.flatMap((value) => sync("tool result", () => toolResult(value)))),
        { signal: ctx.signal },
      ),
  });
  bb.agents.registerTool({
    name: "list_linked_pull_requests",
    description:
      "List PRs linked to the current BB thread, including their reasons and last fetched statuses.",
    parameters: z.object({}),
    execute: (_, ctx) =>
      runtime.runPromise(
        handlers
          .linkedList({ threadId: ctx.threadId })
          .pipe(Effect.flatMap((value) => sync("tool result", () => toolResult(value)))),
        { signal: ctx.signal },
      ),
  });
}
