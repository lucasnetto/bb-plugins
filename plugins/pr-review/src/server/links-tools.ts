import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { Effect } from "effect";
import { sync, type createRuntime } from "./server-effects";
import { reasonSchema } from "../shared/links-contract";
import type { registerLinks } from "./links-server";

type LinkToolHandlers = Pick<
  ReturnType<typeof registerLinks>,
  "linkedLink" | "linkedUnlink" | "linkedList"
>;

type LinkToolResult = Effect.Success<ReturnType<LinkToolHandlers[keyof LinkToolHandlers]>>;

function toolResult(value: LinkToolResult) {
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
  handlers: LinkToolHandlers,
) {
  // The SDK requires Zod for validated agent-tool parameters. RPC uses Standard Schema.
  bb.agents.registerTool({
    name: "link_pull_request",
    description: "Use every time you successfully create a PR to link it to the current BB thread.",
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
