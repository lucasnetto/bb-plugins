import { registerAutoSettle } from "./auto-settle";
import { initializeReviewDatabase } from "./database";
import { registerLinkTools } from "./links-tools";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect, Schema } from "effect";
import { call, sync, createRuntime, decodeSchema, fail, type BackendError } from "./server-effects";
import { randomUUID } from "node:crypto";
import { hostContract, reviewCommentInput } from "../shared/contract";
import {
  linkedContentsInput,
  linkInput,
  linkedPrSchema,
  LINKS_CHANGED,
  parsePrUrl,
  prSummarySchema,
  type LinkedPr,
} from "../shared/links-contract";

/** Normalize the URL and require membership in the caller's current linked-PR snapshot. */
function requireLinkedPr(rows: readonly LinkedPr[], url: string) {
  const ref = parsePrUrl(url);
  if (!rows.some((pr) => pr.url === ref.url))
    throw new Error("This PR is not linked to this thread.");
  return ref;
}

export function registerLinks(bb: BbPluginApi, runtime: ReturnType<typeof createRuntime>) {
  let afterUnlink: (input: {
    threadId: string;
    url: string;
  }) => Effect.Effect<unknown, BackendError> = () => Effect.void;
  const db = initializeReviewDatabase(bb);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const listRows = Effect.fn("LinkedPr.rows")(function* (threadId: string) {
    const rows = yield* sync("linked PR.list", () =>
      db.prepare("SELECT data FROM linked_prs WHERE thread_id = ? ORDER BY rowid").all(threadId),
    );
    const decoded = yield* decodeSchema(
      "linked PR.decode",
      Schema.Array(Schema.Struct({ data: Schema.fromJsonString(linkedPrSchema) })),
      rows,
    );
    return decoded.map(({ data }) => data);
  });
  const changed = (threadId: string) => bb.realtime.publish(LINKS_CHANGED, { threadId });
  const updateSummary = Effect.fn("LinkedPr.updateSummary")(function* (
    summary: Schema.Schema.Type<typeof prSummarySchema>,
  ) {
    // Keep link provenance in each thread while refreshing shared GitHub metadata.
    const { url, repository, number, title, state, isDraft } = summary;
    const rows = yield* sync("linked PR.summary rows", () =>
      db.prepare("SELECT thread_id, data FROM linked_prs WHERE url = ?").all(url),
    );
    const entries = yield* decodeSchema(
      "linked PR.summary rows",
      Schema.Array(Schema.Struct({ thread_id: Schema.String, data: Schema.String })),
      rows,
    );
    yield* Effect.forEach(entries, (entry) =>
      Effect.gen(function* () {
        const current = yield* decodeSchema(
          "linked PR.summary entry",
          Schema.fromJsonString(linkedPrSchema),
          entry.data,
        );
        const data = JSON.stringify({ ...current, url, repository, number, title, state, isDraft });
        if (data === entry.data) return;
        yield* sync("linked PR.update summary", () => {
          const result = db
            .prepare("UPDATE linked_prs SET data = ? WHERE thread_id = ? AND url = ? AND data = ?")
            .run(data, entry.thread_id, url, entry.data);
          if (result.changes > 0) changed(entry.thread_id);
        });
      }),
    );
  });
  const environment = Effect.fn("LinkedPr.environment")(function* (threadId: string) {
    const thread = yield* call("threads.get", () => bb.sdk.threads.get({ threadId }));
    if (!thread.environmentId) {
      const { primaryHostId } = yield* call("system.config", () => bb.sdk.system.config());
      if (!primaryHostId) return yield* fail("Connect a primary machine to fetch this PR.");
      return { root: null, hostId: primaryHostId };
    }
    const environmentId = thread.environmentId;
    const env = yield* call("environments.get", () => bb.sdk.environments.get({ environmentId }));
    return { root: env.path ?? null, hostId: env.hostId };
  });
  bb.ui.registerMentionProvider({
    id: "review-comment",
    label: "Code comments",
    search: () => [],
    resolve: (id) =>
      runtime.runPromise(
        sync("review comment.resolve", () => {
          const row = db.prepare("SELECT context FROM review_comments WHERE id = ?").get(id);
          if (!row)
            throw new Error("This code comment is no longer available. Select the code again.");
          return row;
        }).pipe(
          Effect.flatMap((row) =>
            decodeSchema("review comment.decode", Schema.Struct({ context: Schema.String }), row),
          ),
        ),
      ),
  });
  const handlers = {
    stageReviewComment: Effect.fn("LinkedPr.stageComment")(function* (
      input: Schema.Schema.Type<typeof reviewCommentInput>,
    ) {
      const rows = yield* listRows(input.threadId);
      return yield* sync("review comment.insert", () => {
        requireLinkedPr(rows, input.url);
        const id = randomUUID();
        db.prepare("INSERT INTO review_comments (id, thread_id, context) VALUES (?, ?, ?)").run(
          id,
          input.threadId,
          input.context,
        );
        return { id };
      });
    }),
    linkedContents: ({
      threadId,
      ...input
    }: Schema.Schema.Type<typeof linkedContentsInput> & { threadId: string }) =>
      Effect.gen(function* () {
        const rows = yield* listRows(threadId);
        const ref = yield* sync("linked contents input", () => requireLinkedPr(rows, input.url));
        const env = yield* environment(threadId);
        return yield* call("host.linkedContents", (signal) =>
          host.call(
            "linkedContents",
            { ...input, url: ref.url, root: env.root },
            { hostId: env.hostId, signal },
          ),
        );
      }),
    linkedList: Effect.fn("LinkedPr.list")(({ threadId }: { threadId: string }) =>
      listRows(threadId),
    ),
    linkedLink: ({
      threadId,
      ...input
    }: Schema.Schema.Type<typeof linkInput> & { threadId: string }) =>
      Effect.gen(function* () {
        const ref = yield* sync("parse PR URL", () => parsePrUrl(input.url));
        const existing = (yield* listRows(threadId)).find((pr) => pr.url === ref.url);
        if (existing) return existing;
        const env = yield* environment(threadId);
        const summary = yield* call("host.linkedSummary", (signal) =>
          host.call(
            "linkedSummary",
            { root: env.root, url: ref.url },
            { hostId: env.hostId, signal },
          ),
        );
        const entry = yield* decodeSchema("linked PR.entry", linkedPrSchema, {
          ...summary,
          ...ref,
          reason: input.reason,
          linkedAt: Date.now(),
        });
        yield* sync("save linked PR", () => {
          db.prepare(
            "INSERT OR IGNORE INTO linked_prs (thread_id, url, data) VALUES (?, ?, ?)",
          ).run(threadId, ref.url, JSON.stringify(entry));
          changed(threadId);
        });
        const saved = (yield* listRows(threadId)).find((pr) => pr.url === ref.url);
        if (!saved) return yield* fail("Linked PR was not saved.");
        return saved;
      }),
    linkedUnlink: Effect.fn("LinkedPr.unlink")(function* ({
      threadId,
      url,
    }: {
      threadId: string;
      url: string;
    }) {
      const ref = yield* sync("unlink URL", () => parsePrUrl(url));
      const result = yield* sync("linked PR.delete", () => {
        db.prepare("DELETE FROM review_guides WHERE thread_id = ? AND url = ?").run(
          threadId,
          ref.url,
        );
        const result = db
          .prepare("DELETE FROM linked_prs WHERE thread_id = ? AND url = ?")
          .run(threadId, ref.url);
        changed(threadId);
        return { removed: result.changes > 0 };
      });
      yield* afterUnlink({ threadId, url: ref.url });
      return result;
    }),
    linkedDetail: ({ threadId, url }: { threadId: string; url: string }) =>
      Effect.gen(function* () {
        const rows = yield* listRows(threadId);
        const ref = yield* sync("linked detail input", () => requireLinkedPr(rows, url));
        const env = yield* environment(threadId);
        const detail = yield* call("host.linkedDetail", (signal) =>
          host.call(
            "linkedDetail",
            { root: env.root, url: ref.url },
            { hostId: env.hostId, signal },
          ),
        );
        const current = (yield* listRows(threadId)).find((pr) => pr.url === ref.url);
        yield* sync("refresh linked PR", () => {
          if (current) {
            db.prepare("UPDATE linked_prs SET data = ? WHERE thread_id = ? AND url = ?").run(
              JSON.stringify({ ...current, ...detail.pr, ...ref }),
              threadId,
              ref.url,
            );
            changed(threadId);
          }
        });
        return detail;
      }),
  };
  registerAutoSettle(bb, runtime, db, {
    list: listRows,
    refresh: Effect.fn("LinkedPr.refreshSummaries")(function* (
      threadId: string,
      rows: readonly LinkedPr[],
    ) {
      const env = yield* environment(threadId);
      const refreshed = yield* Effect.forEach(rows, (row) =>
        call("host.linkedSummary", (signal) =>
          host.call(
            "linkedSummary",
            { root: env.root, url: row.url },
            { hostId: env.hostId, signal },
          ),
        ).pipe(
          Effect.flatMap((summary) =>
            decodeSchema("linked PR.summary", linkedPrSchema, {
              ...row,
              ...summary,
              ...parsePrUrl(row.url),
            }),
          ),
        ),
      );
      yield* sync("refresh linked summaries", () => {
        const update = db.prepare(
          "UPDATE linked_prs SET data = ? WHERE thread_id = ? AND url = ? AND data = ?",
        );
        refreshed.forEach((row, index) =>
          update.run(JSON.stringify(row), threadId, row.url, JSON.stringify(rows[index])),
        );
        changed(threadId);
      });
      return refreshed;
    }),
  });
  registerLinkTools(bb, runtime, handlers);
  bb.events.on("thread.deleted", ({ thread }) =>
    runtime.runPromise(
      sync("thread PR cleanup", () => {
        db.prepare("DELETE FROM review_guides WHERE thread_id = ?").run(thread.id);
        db.prepare("DELETE FROM review_comments WHERE thread_id = ?").run(thread.id);
        db.prepare("DELETE FROM linked_prs WHERE thread_id = ?").run(thread.id);
        db.prepare("DELETE FROM pr_auto_settled WHERE thread_id = ?").run(thread.id);
        changed(thread.id);
      }),
    ),
  );
  // Public read-only integration used by the separate T3 Sidebar plugin.
  bb.http.route("POST", "/linked-prs", (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const raw = yield* call("linked PR request", () => c.req.json());
        const { threadIds } = yield* decodeSchema(
          "linked PR input",
          Schema.Struct({
            threadIds: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
          }),
          raw,
        );
        const entries = yield* Effect.forEach(threadIds, (threadId) =>
          handlers.linkedList({ threadId }).pipe(Effect.map((rows) => [threadId, rows] as const)),
        );
        return c.json(Object.fromEntries(entries));
      }),
    ),
  );
  return {
    ...handlers,
    updateSummary,
    onUnlink: (cleanup: typeof afterUnlink) => {
      afterUnlink = cleanup;
    },
  };
}
