import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Schema, Semaphore } from "effect";
import { completionTime, type LinkedPr } from "../shared/links-contract";
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

const latestCompletion = (rows: readonly LinkedPr[]) => {
  const times = rows.map(completionTime);

  return times.some((time) => time === null)
    ? null
    : Math.max(...times.filter((time) => time !== null));
};

/** React to observed PR completion, with polling as a fallback when no panel is open. */
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
    if (!(yield* call("auto settle.settings", () => settings.get())).autoSettle) return;
    const before = yield* eligible(threadId);

    if (!before) return;
    const rows = yield* links.list(threadId);

    if (rows.length === 0) return;
    // Confirm mutable PRs; a timestamped merge can be reused across checks.
    const refreshed = yield* links.refresh(threadId, rows);

    if (!terminal(refreshed)) return;
    const completedAt = latestCompletion(refreshed);

    if (completedAt === null) return;

    const prompts = yield* call("threads.promptHistory", (signal) =>
      bb.sdk.threads.promptHistory({ threadId, limit: "1", signal }),
    );

    const latestRequestAt = Math.max(
      before.createdAt,
      ...prompts.map((prompt) => prompt.createdAt),
    );

    if (completedAt < latestRequestAt) return;
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

    if (
      fingerprint(current) !== key ||
      !terminal(current) ||
      latestCompletion(current) !== completedAt
    )
      return;

    if (!(yield* call("auto settle.settings", () => settings.get())).autoSettle) return;
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

  // Ref-count waiters as well as holders so a lock cannot be replaced while in use.
  const locks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>();

  const withThreadLock = (threadId: string, effect: Effect.Effect<void, BackendError>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const lock = locks.get(threadId) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 };
        lock.users++;
        locks.set(threadId, lock);

        return lock;
      }),
      (lock) => effect.pipe(Semaphore.withPermit(lock.semaphore)),
      (lock) =>
        Effect.sync(() => {
          if (--lock.users === 0) locks.delete(threadId);
        }),
    );

  const attempt = Effect.fn("AutoSettle.attempt")((threadId: string) =>
    withThreadLock(threadId, check(threadId)).pipe(
      Effect.catchTag("BackendError", (error) =>
        sync("auto settle.log", () => {
          bb.log.warn(`Could not auto-settle ${threadId}; will retry next pass: ${error.message}`);
        }),
      ),
    ),
  );

  const observed = Effect.fn("AutoSettle.observed")(function* (threadId: string) {
    // Avoid extra GitHub calls while any known linked PR is still open.
    if (terminal(yield* links.list(threadId))) yield* attempt(threadId);
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

    yield* Effect.forEach(rows, ({ thread_id }) => attempt(thread_id), {
      discard: true,
      concurrency: 8,
    });
  });

  let running = false;
  bb.background.schedule("settle-completed-prs", "* * * * *", async () => {
    if (running) return;
    running = true;

    try {
      await runtime.runPromise(sweep());
    } finally {
      running = false;
    }
  });

  return { observed };
}
