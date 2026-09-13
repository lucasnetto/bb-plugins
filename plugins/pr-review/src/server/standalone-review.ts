import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Schema } from "effect";
import { hostContract } from "../shared/contract";
import { linkedContentsInput, parsePrUrl } from "../shared/links-contract";
import { call, sync, fail } from "./server-effects";

export function reviewDraftHandlers(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  const primary = Effect.fn("Review.primary")(function* () {
    const { primaryHostId } = yield* call("system.config", () => bb.sdk.system.config());

    if (!primaryHostId)
      return yield* fail("Connect a primary machine to BB to review pull requests.");

    return primaryHostId;
  });

  return {
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
  };
}
