import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Event = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>>[number];

export function messageText(event: Event): string | null {
  if (event.type === "client/turn/requested" && event.data.initiator !== "system") {
    const parts = event.data.input.map((part) => {
      if (part.type === "text") return part.text;

      return "[Historical attachment; contents were not copied]";
    });

    return `${event.data.initiator === "user" ? "USER" : "AGENT REQUEST"}:\n${parts.join("\n")}`;
  }

  if (event.type === "item/completed" && event.data.item.type === "agentMessage")
    return `ASSISTANT:\n${event.data.item.text}`;

  return null;
}

export async function readHistory(bb: BbPluginApi, threadId: string) {
  const first = await bb.sdk.threads.events.list({
    threadId,
    types: ["client/turn/requested"],
    order: "asc",
    limit: "100",
  });

  const original = first.find((event) => messageText(event));
  const originalText = original ? messageText(original) : null;
  const recent: string[] = [];
  let remaining = 40_000;
  let beforeSeq: string | undefined;
  let truncated = (originalText?.length ?? 0) > 8_000;

  for (let page = 0; page < 20; page++) {
    const events = await bb.sdk.threads.events.list({
      threadId,
      types: ["client/turn/requested", "item/completed"],
      order: "desc",
      limit: "100",
      beforeSeq,
    });

    for (const event of events) {
      if (event.seq === original?.seq) continue;
      const text = messageText(event);

      if (!text) continue;

      if (text.length > remaining) {
        recent.unshift(`[Earlier text omitted]\n${text.slice(-remaining)}`);
        remaining = 0;
        truncated = true;
        break;
      }

      recent.unshift(text);
      remaining -= text.length;

      if (!remaining) {
        truncated = true;
        break;
      }
    }

    if (!remaining || events.length < 100) break;
    beforeSeq = String(events.at(-1)?.seq);

    if (page === 19) truncated = true;
  }

  return { originalRequest: originalText?.slice(0, 8_000) ?? null, recent, truncated };
}
