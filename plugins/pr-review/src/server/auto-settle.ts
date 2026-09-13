import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Schema } from "effect";
import type { LinkedPr } from "../shared/links-contract";
import { call, sync, decodeSchema, type BackendError, type createRuntime } from "./server-effects";
import type { initializeReviewDatabase } from "./database";

const fingerprint = (rows: readonly LinkedPr[]) =>
  JSON.stringify(
    [...rows]
      .sort((a, b) => a.url.localeCompare(b.url))
      .map(({ url, linkedAt }) => [url, linkedAt]),
  );

const terminal = (rows: readonly LinkedPr[]) =>
  rows.length > 0 && rows.every(({ state }) => state === "MERGED" || state === "CLOSED");

/** Poll on the server so settling does not depend on an open browser panel. */
export function registerAutoSettle(
  bb: BbPluginApi,
  runtime: ReturnType<typeof createRuntime>,
  db: ReturnType<typeof initializeReviewDatabase>,
  links: {
    list: (threadId: string) => Effect.Effect<LinkedPr[], BackendError>;
    refresh: (
      threadId: string,
      rows: readonly LinkedPr[],
    ) => Effect.Effect<LinkedPr[], BackendError>;
  },
) {
  const settings = bb.settings.define({
    autoSettle: {
      type: "boolean",
      label: "Automatically settle completed PR threads",
      description: "Archive idle threads when all linked pull requests are merged or closed.",
      default: true,
    },
  });

  const eligible = Effect.fn("AutoSettle.eligible")(function* (threadId: string) {
    const thread = yield* call("threads.get", (signal) => bb.sdk.threads.get({ threadId, signal }));

    return thread.status === "idle" &&
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      thread.visibility === "visible" &&
      thread.queuedMessageCount === 0 &&
      thread.activeBackgroundAgentCount === 0
      ? thread
      : null;
  });

  // Native archive cascades to children; do not interrupt their work either.
  const descendantsIdle = (parentThreadId: string): Effect.Effect<boolean, BackendError> =>
    Effect.gen(function* () {
      for (let offset = 0; ; offset += 100) {
        const children = yield* call("threads.listChildren", (signal) =>
          bb.sdk.threads.list({ parentThreadId, includeHidden: true, limit: 100, offset, signal }),
        );

        for (const child of children) {
          if (child.archivedAt !== null || child.deletedAt !== null) continue;

          if (child.status !== "idle") return false;

          const detail = yield* call("threads.getChild", (signal) =>
            bb.sdk.threads.get({ threadId: child.id, signal }),
          );

          if (
            detail.status !== "idle" ||
            detail.queuedMessageCount > 0 ||
            detail.activeBackgroundAgentCount > 0
          )
            return false;

          if (!(yield* descendantsIdle(child.id))) return false;
        }

        if (children.length < 100) return true;
      }
    });

  const check = Effect.fn("AutoSettle.check")(function* (threadId: string) {
    const before = yield* eligible(threadId);

    if (!before) return;
    const rows = yield* links.list(threadId);

    if (rows.length === 0) return;
    // Every PR must be successfully fetched during this pass. Never trust stale terminal states.
    const refreshed = yield* links.refresh(threadId, rows);

    if (!terminal(refreshed)) return;
    const key = fingerprint(refreshed);

    const previous = yield* sync("auto settle.previous", () =>
      db.prepare("SELECT fingerprint FROM pr_auto_settled WHERE thread_id = ?").get(threadId),
    );

    // Keep the existing on-disk format, but compare PR identity, not link timestamps.
    const saved = previous
      ? yield* decodeSchema(
          "auto settle.previous",
          Schema.Struct({
            fingerprint: Schema.fromJsonString(
              Schema.Array(Schema.Tuple([Schema.String, Schema.Finite])),
            ),
          }),
        )(previous)
      : { fingerprint: [] };

    const settledPrs = new Map<string, number>(saved.fingerprint);

    // Un-settle stays open until there is a PR never included in an earlier settlement.
    if (refreshed.every(({ url }) => settledPrs.has(url))) return;

    if (!(yield* descendantsIdle(threadId))) return;
    const after = yield* eligible(threadId);

    if (!after || after.updatedAt !== before.updatedAt) return;
    const current = yield* links.list(threadId);

    if (fingerprint(current) !== key || !terminal(current)) return;
    yield* call("threads.archive", () => bb.sdk.threads.archive({ threadId }));
    yield* sync("auto settle.remember", () => {
      db.prepare(
        "INSERT OR REPLACE INTO pr_auto_settled (thread_id, fingerprint) VALUES (?, ?)",
      ).run(
        threadId,
        JSON.stringify(
          [
            ...new Map([
              ...settledPrs,
              ...current.map(({ url, linkedAt }) => [url, linkedAt] as const),
            ]),
          ].sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
      bb.log.info(`Settled ${threadId}: all linked PRs are merged or closed`);
    });
  });

  const sweep = Effect.fn("AutoSettle.sweep")(function* () {
    if (!(yield* call("auto settle.settings", () => settings.get())).autoSettle) return;

    const raw = yield* sync("auto settle.threads", () =>
      db.prepare("SELECT DISTINCT thread_id FROM linked_prs").all(),
    );

    const rows = yield* decodeSchema(
      "auto settle.threads",
      Schema.Array(Schema.Struct({ thread_id: Schema.String })),
    )(raw);

    yield* Effect.forEach(
      rows,
      ({ thread_id }) =>
        check(thread_id).pipe(
          Effect.catchTag("BackendError", (error) =>
            sync("auto settle.log", () => {
              bb.log.warn(
                `Could not auto-settle ${thread_id}; will retry next pass: ${error.message}`,
              );
            }),
          ),
        ),
      { discard: true },
    );
  });

  let running = false;
  bb.background.schedule("settle-completed-prs", "*/5 * * * *", async () => {
    if (running) return;
    running = true;

    try {
      await runtime.runPromise(sweep());
    } finally {
      running = false;
    }
  });
}
