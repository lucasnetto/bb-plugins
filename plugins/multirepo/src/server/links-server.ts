import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { Effect, Schema } from "effect";
import { call, sync, createRuntime, decodeSchema, fail } from "./server-effects";
import { randomUUID } from "node:crypto";
import { hostContract, reviewCommentInput } from "../shared/contract";
import {
  linkedContentsInput,
  linkInput,
  reasonSchema,
  linkedPrSchema,
  LINKS_CHANGED,
  parsePrUrl,
} from "../shared/links-contract";

function toolResult(value: unknown) {
  const text = JSON.stringify(value);
  // Match BB's documented agent-facing CLI transport ceiling.
  if (Buffer.byteLength(text) > PLUGIN_CLI_OUTPUT_MAX_BYTES)
    throw new Error(
      "Too many linked PRs to return through the agent transport. Open the Linked PRs panel.",
    );
  return text;
}
export function registerLinks(bb: BbPluginApi, runtime: ReturnType<typeof createRuntime>) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE linked_prs (thread_id TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id, url))",
    "CREATE TABLE review_comments (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, context TEXT NOT NULL)",
  ]);
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
  const environment = Effect.fn("LinkedPr.environment")(function* (threadId: string) {
    const thread = yield* call("threads.get", () => bb.sdk.threads.get({ threadId }));
    if (!thread.environmentId)
      return yield* sync("thread workspace", () => {
        throw new Error("This thread needs a workspace before a PR can be fetched.");
      });
    const environmentId = thread.environmentId;
    const env = yield* call("environments.get", () => bb.sdk.environments.get({ environmentId }));
    if (!env.path)
      return yield* sync("thread workspace", () => {
        throw new Error("The thread environment has no workspace path.");
      });
    return { root: env.path, hostId: env.hostId };
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
        const ref = parsePrUrl(input.url);
        if (!rows.some((pr) => pr.url === ref.url))
          throw new Error("This PR is not linked to this thread.");
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
        const ref = yield* sync("linked contents input", () => {
          const ref = parsePrUrl(input.url);
          if (!rows.some((pr) => pr.url === ref.url))
            throw new Error("This PR is not linked to this thread.");
          return ref;
        });
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
    linkedUnlink: Effect.fn("LinkedPr.unlink")(
      ({ threadId, url }: { threadId: string; url: string }) =>
        sync("linked PR.delete", () => {
          const ref = parsePrUrl(url);
          const result = db
            .prepare("DELETE FROM linked_prs WHERE thread_id = ? AND url = ?")
            .run(threadId, ref.url);
          changed(threadId);
          return { removed: result.changes > 0 };
        }),
    ),
    linkedDetail: ({ threadId, url }: { threadId: string; url: string }) =>
      Effect.gen(function* () {
        const rows = yield* listRows(threadId);
        const ref = yield* sync("linked detail input", () => {
          const ref = parsePrUrl(url);
          if (!rows.some((pr) => pr.url === ref.url))
            throw new Error("This PR is not linked to this thread.");
          return ref;
        });
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
  // The SDK requires Zod for validated agent-tool parameters. RPC uses Standard Schema.
  bb.agents.registerTool({
    name: "link_pull_request",
    description:
      "Link a GitHub pull request to the current BB thread. Supports several repositories and PRs. Does not post to GitHub.",
    instructions:
      "Call link_pull_request after successfully creating a PR, when the user asks you to review or work on a PR, or explicitly asks to link one. Use created-here, requested-review, requested-work, or manual as the reason. Do not link PRs mentioned only as examples or background. Preserve existing links. Use unlink_pull_request when asked to remove a link; list_linked_pull_requests shows current links. If these tools are unavailable in an existing session, use bb multirepo link <url> <reason>, unlink <url>, or links in the current thread.",
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
  bb.events.on("thread.deleted", ({ thread }) =>
    runtime.runPromise(
      sync("thread PR cleanup", () => {
        db.prepare("DELETE FROM review_comments WHERE thread_id = ?").run(thread.id);
        db.prepare("DELETE FROM linked_prs WHERE thread_id = ?").run(thread.id);
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
  return handlers;
}
