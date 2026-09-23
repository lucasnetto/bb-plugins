import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { redact, type Packet } from "./domain";
import { Store } from "./store";

type Threads = BbPluginApi["sdk"]["threads"];

export async function revisionOf(threads: Threads, threadId: string, signal: AbortSignal) {
  const thread = await threads.get({ threadId, signal });
  const last = await threads.events.list({ threadId, order: "desc", limit: "1", signal });

  return {
    thread,
    sequence: last[0]?.seq ?? 0,
    revision: `${thread.updatedAt}:${thread.status}:${thread.archivedAt}:${thread.deletedAt}:${last[0]?.seq ?? 0}`,
  };
}

export async function captureHistory(
  threads: Threads,
  store: Store,
  threadId: string,
  projectId: string,
  limit: number,
  secret: string,
  signal: AbortSignal,
): Promise<Packet | null> {
  const head = await revisionOf(threads, threadId, signal);
  signal.throwIfAborted();

  if (
    head.thread.projectId !== projectId ||
    head.thread.archivedAt !== null ||
    head.thread.deletedAt !== null ||
    head.thread.visibility === "hidden"
  ) {
    store.forget(threadId);

    return null;
  }

  const previous = store.subject(threadId);

  if (previous?.revision === head.revision && !previous.dirty) return null;
  store.touch(threadId, projectId, head.revision);
  let cursor = previous?.cursor ?? 0;

  // A bounded page batch yields to other subjects; dirty remains durable until caught up.
  for (let page = 0; page < 10 && cursor < head.sequence; page++) {
    const rows = await threads.events.list({
      threadId,
      afterSeq: String(cursor),
      beforeSeq: String(head.sequence + 1),
      order: "asc",
      limit: "100",
      signal,
    });

    signal.throwIfAborted();

    if (store.subject(threadId)?.revision !== head.revision) return null;

    if (!rows.length) throw new Error("History coverage is incomplete");
    const evidence: Packet["evidence"] = [];
    let next = cursor;

    for (const row of rows) {
      if (row.seq <= cursor || row.seq > head.sequence) continue;
      next = Math.max(next, row.seq);
      let text = "";

      // Only finalized visible messages. Never serialize provider payloads, reasoning,
      // tool arguments, environment values, or hidden provider-internal state.
      if (row.type === "item/completed") {
        if (row.data.item.type === "agentMessage") text = row.data.item.text;

        if (row.data.item.type === "userMessage")
          text = row.data.item.content
            .flatMap((c) => (c.type === "text" ? [c.text] : []))
            .join("\n");
      }

      if (!text) continue;
      const safe = redact(text, secret);
      evidence.push({
        id: row.id,
        sourceId: row.id,
        sequence: row.seq,
        kind: "thread_event",
        text: safe.slice(0, limit),
        truncated: safe.length > limit,
        role:
          row.type === "item/completed" && row.data.item.type === "userMessage"
            ? "user"
            : "assistant",
      });
    }

    if (next === cursor) throw new Error("History pagination made no progress");
    store.capture(threadId, head.revision, next, evidence);
    cursor = next;
  }

  if (cursor < head.sequence) return null;
  const evidence = store.evidence(threadId);
  let remaining = limit;
  const bounded: Packet["evidence"] = [];

  for (const item of evidence.toReversed()) {
    if (remaining <= 0) break;
    const text = item.text.slice(-remaining);
    remaining -= text.length;
    bounded.unshift({ ...item, text, truncated: item.truncated || text.length < item.text.length });
  }

  return {
    version: 1,
    subjectId: threadId,
    threadId,
    projectId,
    environmentId: head.thread.environmentId,
    revision: head.revision,
    sequence: head.sequence,
    fixture: null,
    evidence: bounded,
    coverage: "bounded",
    omitted: Math.max(0, head.sequence - bounded.length),
    ruleVersion: "attention-1",
    contextVersion: "visible-events-1",
  };
}
