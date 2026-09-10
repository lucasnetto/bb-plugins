import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Schema } from "effect";
import { hostContract } from "../shared/contract";
import { linkedContentsInput, parsePrUrl } from "../shared/links-contract";
import { startReviewInput } from "../shared/review-draft-contract";
import { call, sync, fail } from "./server-effects";
import type { registerLinks } from "./links-server";

export function reviewDraftHandlers(
  bb: BbPluginApi,
  links: Pick<ReturnType<typeof registerLinks>, "linkedLink">,
) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const primary = Effect.fn("Review.primary")(function* () {
    const { primaryHostId } = yield* call("system.config", () => bb.sdk.system.config());
    if (!primaryHostId)
      return yield* fail("Connect a primary machine to BB to review pull requests.");
    return primaryHostId;
  });
  return {
    reviewDraftDefaults: Effect.fn("Review.defaults")(function* () {
      const hostId = yield* primary();
      const projects = yield* call("projects.list", () =>
        bb.sdk.projects.list({ includePersonal: true }),
      );
      const project = projects.find((project) => project.kind === "personal");
      if (!project) return yield* fail("BB's personal project is unavailable.");
      return { hostId, projectId: project.id };
    }),
    reviewDraftDetail: Effect.fn("Review.detail")(function* ({ url }: { url: string }) {
      const ref = yield* sync("review URL", () => parsePrUrl(url));
      const hostId = yield* primary();
      return yield* call("host.linkedDetail", (signal) =>
        host.call("linkedDetail", { root: null, url: ref.url }, { hostId, signal }),
      );
    }),
    reviewDraftContents: Effect.fn("Review.contents")(function* (
      input: Schema.Schema.Type<typeof linkedContentsInput>,
    ) {
      const ref = yield* sync("review URL", () => parsePrUrl(input.url));
      const hostId = yield* primary();
      return yield* call("host.linkedContents", (signal) =>
        host.call("linkedContents", { ...input, root: null, url: ref.url }, { hostId, signal }),
      );
    }),
    startReview: Effect.fn("Review.start")(function* ({
      url,
      request,
      comments,
    }: Schema.Schema.Type<typeof startReviewInput>) {
      const ref = yield* sync("review URL", () => parsePrUrl(url));
      if (!request.input.some((entry) => entry.type !== "text" || entry.text.trim()))
        return yield* fail("Write a message before starting the conversation.");
      const hostId = yield* primary();
      const pr = yield* call("host.linkedSummary", (signal) =>
        host.call("linkedSummary", { root: null, url: ref.url }, { hostId, signal }),
      );
      // This handler is called only by the composer's explicit Send action.
      const context = [
        `Pull request: ${ref.url}`,
        ...comments.map(
          (comment) =>
            `${comment.label}\n${comment.text}\n\nSelected PR context:\n${comment.context}`,
        ),
      ].join("\n\n");
      const thread = yield* call("threads.spawn", () =>
        bb.sdk.threads.spawn({
          ...request,
          title: pr.title,
          input: [{ type: "text", text: context, mentions: [] }, ...request.input],
        }),
      );
      // Return the created thread even on link failure so Send cannot duplicate it.
      const warning = yield* links
        .linkedLink({ threadId: thread.id, url: ref.url, reason: "manual" })
        .pipe(
          Effect.as(null as string | null),
          Effect.catchTag("BackendError", (error) =>
            Effect.succeed(
              `Thread created, but linking the PR failed: ${error.message}. Retry from the Linked PRs panel.`,
            ),
          ),
        );
      return { threadId: thread.id, warning };
    }),
  };
}
