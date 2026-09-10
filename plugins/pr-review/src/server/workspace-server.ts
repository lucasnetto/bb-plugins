import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { workspaceHostContract, workspaceRpcContract } from "../shared/workspace-contract";
import { parsePrUrl } from "../shared/links-contract";
import { call, sync, fail, handler } from "./server-effects";
import type { createRuntime } from "./server-effects";
import type { registerLinks } from "./links-server";
import { LIST_CHANGED } from "../../contract";

export function registerWorkspace(
  bb: BbPluginApi,
  runtime: ReturnType<typeof createRuntime>,
  links: Pick<ReturnType<typeof registerLinks>, "linkedList" | "updateSummary">,
) {
  const host = bb.hosts.experimental_client({ contract: workspaceHostContract });
  const target = Effect.fn("PrWorkspace.target")(function* (input: {
    threadId: string | null;
    url: string;
  }) {
    const ref = yield* sync("PR URL", () => parsePrUrl(input.url));
    if (input.threadId) {
      const threadId = input.threadId;
      const rows = yield* links.linkedList({ threadId });
      if (!rows.some((row) => row.url === ref.url))
        return yield* fail("This PR is not linked to this thread.");
      const thread = yield* call("threads.get", () => bb.sdk.threads.get({ threadId }));
      if (thread.environmentId) {
        const environmentId = thread.environmentId;
        const env = yield* call("environments.get", () =>
          bb.sdk.environments.get({ environmentId }),
        );
        return { root: env.path ?? null, url: ref.url, hostId: env.hostId };
      }
    }
    const config = yield* call("system.config", () => bb.sdk.system.config());
    if (!config.primaryHostId)
      return yield* fail("Connect a primary machine to manage pull requests.");
    return { root: null, url: ref.url, hostId: config.primaryHostId };
  });
  bb.rpc.register(workspaceRpcContract, {
    prOverview: handler(runtime, (input) =>
      Effect.gen(function* () {
        const { hostId, ...args } = yield* target(input);
        const overview = yield* call("host.prOverview", (signal) =>
          host.call("prOverview", args, { hostId, signal }),
        );
        yield* links.updateSummary(overview);
        return overview;
      }),
    ),
    prTimeline: handler(runtime, (input) =>
      Effect.gen(function* () {
        const { hostId, ...args } = yield* target(input);
        return yield* call("host.prTimeline", (signal) =>
          host.call("prTimeline", { ...args, page: input.page }, { hostId, signal }),
        );
      }),
    ),
    prStack: handler(runtime, (input) =>
      Effect.gen(function* () {
        const { hostId, ...args } = yield* target(input);
        const stack = yield* call("host.prStack", (signal) =>
          host.call("prStack", args, { hostId, signal }),
        );
        if (stack) {
          const { repository } = parsePrUrl(args.url);
          yield* Effect.forEach(stack.layers, (layer) =>
            links.updateSummary({ ...layer, repository }),
          );
        }
        return stack;
      }),
    ),
    prCandidates: handler(runtime, (input) =>
      Effect.gen(function* () {
        const { hostId, ...args } = yield* target(input);
        return yield* call("host.prCandidates", (signal) =>
          host.call("prCandidates", args, { hostId, signal }),
        );
      }),
    ),
    prMergeStatus: handler(runtime, (input) =>
      Effect.gen(function* () {
        const { hostId, ...args } = yield* target(input);
        const result = yield* call("host.prMergeStatus", (signal) =>
          host.call("prMergeStatus", { ...args, id: input.id }, { hostId, signal }),
        );
        if (result.status !== "pending") bb.realtime.publish(LIST_CHANGED, { mutation: true });
        return result;
      }),
    ),
    prAction: handler(runtime, (input) =>
      Effect.gen(function* () {
        const { hostId, ...args } = yield* target(input);
        const result = yield* call("host.prAction", (signal) =>
          host.call(
            "prAction",
            { ...args, head: input.head, base: input.base, action: input.action },
            { hostId, signal },
          ),
        );
        // Visible lists refresh after explicit writes; ordinary metadata polls stay cheap.
        bb.realtime.publish(LIST_CHANGED, { mutation: true });
        return result;
      }),
    ),
  });
}
