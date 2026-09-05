import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { hostContract, reviewCommentInput } from "./contract";
import {
  linkedContentsInput,
  linkInput,
  linkedPrSchema,
  LINKS_CHANGED,
  parsePrUrl,
} from "./links-contract";

function toolResult(value: unknown) {
  const text = JSON.stringify(value);
  // Match BB's documented agent-facing CLI transport ceiling.
  if (Buffer.byteLength(text) > PLUGIN_CLI_OUTPUT_MAX_BYTES)
    throw new Error(
      "Too many linked PRs to return through the agent transport. Open the Linked PRs panel.",
    );
  return text;
}
export function registerLinks(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE linked_prs (thread_id TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id, url))",
    "CREATE TABLE review_comments (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, context TEXT NOT NULL)",
  ]);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const list = (threadId: string) =>
    db
      .prepare("SELECT data FROM linked_prs WHERE thread_id = ? ORDER BY rowid")
      .all(threadId)
      .map((row) =>
        linkedPrSchema.parse(JSON.parse(z.object({ data: z.string() }).parse(row).data)),
      );
  const changed = (threadId: string) => bb.realtime.publish(LINKS_CHANGED, { threadId });
  async function environment(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId)
      throw new Error("This thread needs a workspace before a PR can be fetched.");
    const env = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    if (!env.path) throw new Error("The thread environment has no workspace path.");
    return { root: env.path, hostId: env.hostId };
  }
  bb.ui.registerMentionProvider({
    id: "review-comment",
    label: "Code comments",
    search: () => [],
    resolve: (id) => {
      const row = db.prepare("SELECT context FROM review_comments WHERE id = ?").get(id);
      if (!row) throw new Error("This code comment is no longer available. Select the code again.");
      return z.object({ context: z.string() }).parse(row);
    },
  });
  const handlers = {
    stageReviewComment: async (input: z.infer<typeof reviewCommentInput>) => {
      const ref = parsePrUrl(input.url);
      if (!list(input.threadId).some((pr) => pr.url === ref.url))
        throw new Error("This PR is not linked to this thread.");
      const id = randomUUID();
      db.prepare("INSERT INTO review_comments (id, thread_id, context) VALUES (?, ?, ?)").run(
        id,
        input.threadId,
        input.context,
      );
      return { id };
    },
    linkedContents: async ({
      threadId,
      ...input
    }: z.infer<typeof linkedContentsInput> & { threadId: string }) => {
      const ref = parsePrUrl(input.url);
      if (!list(threadId).some((pr) => pr.url === ref.url))
        throw new Error("This PR is not linked to this thread.");
      const env = await environment(threadId);
      return host.call(
        "linkedContents",
        { ...input, url: ref.url, root: env.root },
        { hostId: env.hostId },
      );
    },
    linkedList: async ({ threadId }: { threadId: string }) => list(threadId),
    linkedLink: async ({
      threadId,
      ...input
    }: z.infer<typeof linkInput> & { threadId: string }) => {
      const ref = parsePrUrl(input.url);
      const existing = list(threadId).find((pr) => pr.url === ref.url);
      if (existing) return existing;
      const env = await environment(threadId);
      const summary = await host.call(
        "linkedSummary",
        { root: env.root, url: ref.url },
        { hostId: env.hostId },
      );
      const entry = linkedPrSchema.parse({
        ...summary,
        ...ref,
        reason: input.reason,
        linkedAt: Date.now(),
      });
      db.prepare("INSERT OR IGNORE INTO linked_prs (thread_id, url, data) VALUES (?, ?, ?)").run(
        threadId,
        ref.url,
        JSON.stringify(entry),
      );
      changed(threadId);
      return list(threadId).find((pr) => pr.url === ref.url)!;
    },
    linkedUnlink: async ({ threadId, url }: { threadId: string; url: string }) => {
      const ref = parsePrUrl(url);
      const result = db
        .prepare("DELETE FROM linked_prs WHERE thread_id = ? AND url = ?")
        .run(threadId, ref.url);
      changed(threadId);
      return { removed: result.changes > 0 };
    },
    linkedDetail: async ({ threadId, url }: { threadId: string; url: string }) => {
      const ref = parsePrUrl(url);
      if (!list(threadId).some((pr) => pr.url === ref.url))
        throw new Error("This PR is not linked to this thread.");
      const env = await environment(threadId);
      const detail = await host.call(
        "linkedDetail",
        { root: env.root, url: ref.url },
        { hostId: env.hostId },
      );
      const current = list(threadId).find((pr) => pr.url === ref.url);
      if (current) {
        db.prepare("UPDATE linked_prs SET data = ? WHERE thread_id = ? AND url = ?").run(
          JSON.stringify({ ...current, ...detail.pr, ...ref }),
          threadId,
          ref.url,
        );
        changed(threadId);
      }
      return detail;
    },
  };
  bb.agents.registerTool({
    name: "link_pull_request",
    description:
      "Link a GitHub pull request to the current BB thread. Supports several repositories and PRs. Does not post to GitHub.",
    instructions:
      "Call link_pull_request after successfully creating a PR, when the user asks you to review or work on a PR, or explicitly asks to link one. Use created-here, requested-review, requested-work, or manual as the reason. Do not link PRs mentioned only as examples or background. Preserve existing links. Use unlink_pull_request when asked to remove a link; list_linked_pull_requests shows current links. If these tools are unavailable in an existing session, use bb multirepo link <url> <reason>, unlink <url>, or links in the current thread.",
    parameters: linkInput,
    execute: async (input, ctx) =>
      toolResult(await handlers.linkedLink({ ...input, threadId: ctx.threadId })),
  });
  bb.agents.registerTool({
    name: "unlink_pull_request",
    description:
      "Remove one PR link from the current BB thread. Does not close or change the PR on GitHub.",
    parameters: z.object({ url: z.string() }),
    execute: async (input, ctx) =>
      toolResult(await handlers.linkedUnlink({ ...input, threadId: ctx.threadId })),
  });
  bb.agents.registerTool({
    name: "list_linked_pull_requests",
    description:
      "List PRs linked to the current BB thread, including their reasons and last fetched statuses.",
    parameters: z.object({}),
    execute: async (_, ctx) => toolResult(list(ctx.threadId)),
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    db.prepare("DELETE FROM review_comments WHERE thread_id = ?").run(thread.id);
    db.prepare("DELETE FROM linked_prs WHERE thread_id = ?").run(thread.id);
    changed(thread.id);
  });
  // Public read-only integration used by the separate T3 Sidebar plugin.
  bb.http.route("POST", "/linked-prs", async (c) => {
    const { threadIds } = z
      .object({ threadIds: z.array(z.string().min(1)) })
      .parse(await c.req.json());
    return c.json(Object.fromEntries(threadIds.map((id) => [id, list(id)])));
  });
  return handlers;
}
