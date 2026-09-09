import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Schema } from "effect";
import { hostContract } from "../shared/contract";
import { githubReviewTarget, githubReviewMutation } from "../shared/github-review-contract";
import { parsePrUrl } from "../shared/links-contract";
import { call, sync, fail } from "./server-effects";
import type { registerLinks } from "./links-server";

export function githubReviewHandlers(
  bb: BbPluginApi,
  links: Pick<ReturnType<typeof registerLinks>, "linkedList">,
) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const target = Effect.fn("GithubReview.target")(function* (
    input: Schema.Schema.Type<typeof githubReviewTarget>,
  ) {
    const ref = yield* sync("review URL", () => parsePrUrl(input.url));
    if (input.threadId) {
      const rows = yield* links.linkedList({ threadId: input.threadId });
      if (!rows.some((row) => row.url === ref.url))
        return yield* fail("This PR is not linked to this thread.");
      const thread = yield* call("threads.get", () =>
        bb.sdk.threads.get({ threadId: input.threadId! }),
      );
      if (thread.environmentId) {
        const environmentId = thread.environmentId;
        const env = yield* call("environments.get", () =>
          bb.sdk.environments.get({ environmentId }),
        );
        return { url: ref.url, root: env.path ?? null, hostId: env.hostId };
      }
    }
    const { primaryHostId } = yield* call("system.config", () => bb.sdk.system.config());
    if (!primaryHostId) return yield* fail("Connect a primary machine to review pull requests.");
    return { url: ref.url, root: null, hostId: primaryHostId };
  });
  return {
    githubReview: Effect.fn("GithubReview.load")(function* (
      input: Schema.Schema.Type<typeof githubReviewTarget>,
    ) {
      const { hostId, ...args } = yield* target(input);
      return yield* call("host.githubReview", (signal) =>
        host.call("githubReview", args, { hostId, signal }),
      );
    }),
    githubReviewMutate: Effect.fn("GithubReview.write")(function* (
      input: Schema.Schema.Type<typeof githubReviewMutation>,
    ) {
      const { hostId, ...args } = yield* target(input);
      return yield* call("host.githubReviewMutate", (signal) =>
        host.call("githubReviewMutate", { ...args, action: input.action }, { hostId, signal }),
      );
    }),
  };
}
