import type { SDKMessage, SDKToolUseMessage, TokenUsage, RunResult } from "@cursor/sdk";
import type { ThreadDelta, DeltaItemShape } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_toolPresentation } from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";

export function boundedValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  return text.length > 48_000 ? `${text.slice(0, 48_000)}… [truncated]` : value;
}

function toolShape(event: SDKToolUseMessage): DeltaItemShape {
  return {
    type: "tool",
    tool: event.name,
    args: boundedValue(event.args),
    result: boundedValue(event.result),
  };
}

/** SDK assistant events are deltas, not snapshots. Close each text block at a
 * tool/channel boundary, and never append run.result to already streamed text. */
export class RunEvents {
  private readonly id = randomUUID();
  private sequence = 0;
  private text: { id: string; channel: "agentMessage" | "reasoningText" } | undefined;
  private tools = new Map<string, DeltaItemShape>();
  private assistantSeen = false;
  private usageSeen = false;
  private total = {
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };

  constructor(private readonly emit: (deltas: ThreadDelta[]) => void) {}

  closeText() {
    if (!this.text) return;
    this.emit([
      { kind: "item.textClose", channel: this.text.channel, key: { providerItemId: this.text.id } },
    ]);
    this.text = undefined;
  }

  append(text: string, channel: "agentMessage" | "reasoningText") {
    if (!text) return;
    if (this.text?.channel !== channel) this.closeText();
    this.text ??= { id: `${this.id}-text-${++this.sequence}`, channel };
    if (channel === "agentMessage") this.assistantSeen = true;
    // Bound every notification even when the SDK emits a large text block.
    for (let offset = 0; offset < text.length; offset += 16_000) {
      this.emit([
        {
          kind: "item.textDelta",
          key: { providerItemId: this.text.id },
          channel,
          text: text.slice(offset, offset + 16_000),
        },
      ]);
    }
  }

  usage(usage: TokenUsage) {
    const last = {
      cachedInputTokens: usage.cacheReadTokens,
      inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      reasoningOutputTokens: usage.reasoningTokens ?? 0,
      totalTokens: usage.totalTokens,
    };
    this.total = {
      cachedInputTokens: this.total.cachedInputTokens + last.cachedInputTokens,
      inputTokens: this.total.inputTokens + last.inputTokens,
      outputTokens: this.total.outputTokens + last.outputTokens,
      reasoningOutputTokens: this.total.reasoningOutputTokens + last.reasoningOutputTokens,
      totalTokens: this.total.totalTokens + last.totalTokens,
    };
    this.emit([{ kind: "usage", last, total: this.total, modelContextWindow: null }]);
  }

  accept(event: SDKMessage) {
    switch (event.type) {
      case "assistant":
        for (const block of event.message.content)
          if (block.type === "text") this.append(block.text, "agentMessage");
        break;
      case "thinking":
        this.append(event.text, "reasoningText");
        break;
      case "tool_call": {
        this.closeText();
        const key = { providerItemId: event.call_id };
        const item = toolShape(event);
        const presentation = experimental_toolPresentation(event.name);
        if (!this.tools.has(event.call_id))
          this.emit([{ kind: "item.open", key, item, presentation }]);
        this.tools.set(event.call_id, item);
        if (event.status !== "running") {
          this.emit([
            {
              kind: "item.close",
              key,
              item,
              presentation,
              status: event.status === "error" ? "failed" : "completed",
            },
          ]);
          this.tools.delete(event.call_id);
        }
        break;
      }
      case "usage":
        this.usageSeen = true;
        this.usage(event.usage);
        break;
      case "status":
        if (event.status === "ERROR" && event.message)
          this.emit([
            {
              kind: "provider.warning",
              category: "general",
              summary: event.message.slice(0, 2000),
            },
          ]);
        break;
      default:
        break;
    }
  }

  finish(result: RunResult) {
    if (!this.assistantSeen && result.result) this.append(result.result, "agentMessage");
    if (!this.usageSeen && result.usage) this.usage(result.usage);
    this.close(
      result.status === "cancelled"
        ? "interrupted"
        : result.status === "error"
          ? "failed"
          : "completed",
    );
  }

  close(status: "completed" | "failed" | "interrupted") {
    this.closeText();
    for (const [id, item] of this.tools)
      this.emit([{ kind: "item.close", key: { providerItemId: id }, item, status }]);
    this.tools.clear();
  }
}
