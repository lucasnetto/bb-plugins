import { Agent, JsonlLocalAgentStore } from "@cursor/sdk";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import { readApiKey } from "../../src/server/operations.js";
import { forkLocalAgent } from "../../src/server/fork.js";

test.skipIf(process.env.CURSOR_SDK_LIVE_FORK !== "1")(
  "live local fork recalls the source conversation with a distinct agent identity",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-fork-live-"));
    const store = new JsonlLocalAgentStore(join(dir, "store"));
    const apiKey = await Effect.runPromise(readApiKey("work"));
    const options = { apiKey, model: { id: "composer-2.5" }, local: { cwd: dir, store } };

    try {
      await using source = await Agent.create(options);

      const first = await source.send(
        "Remember the exact secret marker fork-lilac-84219. Reply only OK. Do not use any tools.",
      );

      await first.wait();

      await using child = await Effect.runPromise(
        forkLocalAgent(store, source.agentId, dir, (id) => Agent.resume(id, options)),
      );

      expect(child.agentId).not.toBe(source.agentId);

      const second = await child.send(
        "What was the exact secret marker from my previous message? Reply only with that marker. Do not use any tools.",
      );

      const result = await second.wait();
      expect(result.result).toContain("fork-lilac-84219");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  120_000,
);
