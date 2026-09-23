import { Agent, JsonlLocalAgentStore } from "@cursor/sdk";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import { readApiKey } from "../../src/server/operations.js";
import { forkLocalAgent } from "../../src/server/fork.js";

test.skipIf(process.env.CURSOR_SDK_LIVE_REWIND !== "1")(
  "live historical fork remembers the earlier turn without the later correction",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-rewind-live-"));
    const store = new JsonlLocalAgentStore(join(dir, "store"));
    const apiKey = await Effect.runPromise(readApiKey("personal"));
    const options = { apiKey, model: { id: "composer-2.5" }, local: { cwd: dir, store } };

    try {
      await using source = await Agent.create(options);

      const first = await source.send(
        "Remember the exact marker rewind-lilac-84219. Reply only OK. Do not use any tools.",
      );

      expect((await first.wait()).status).toBe("finished");
      const savedRun = await store.runs.get({ agentId: source.agentId, runId: first.id });
      const checkpointId = savedRun?.latestCheckpointRef?.rootBlobId;

      if (!checkpointId) throw new Error("The SDK did not persist a completed checkpoint");

      const later = await source.send(
        "Replace the marker with rewind-amber-53726. Forget the earlier marker. Reply only OK. Do not use any tools.",
      );

      expect((await later.wait()).status).toBe("finished");
      const current = await store.agents.get({ agentId: source.agentId });
      expect(current?.latestCheckpoint?.rootBlobId).not.toBe(checkpointId);

      await using child = await Effect.runPromise(
        forkLocalAgent(
          store,
          source.agentId,
          dir,
          (id) => Agent.resume(id, options),
          undefined,
          checkpointId,
        ),
      );

      expect(child.agentId).not.toBe(source.agentId);

      const answer = await child.send(
        "What is the current marker? Reply only with the marker. Do not use any tools.",
      );

      const result = await answer.wait();
      expect(result.status).toBe("finished");
      expect(result.result).toContain("rewind-lilac-84219");
      expect(result.result).not.toContain("rewind-amber-53726");
      expect(await store.agents.get({ agentId: source.agentId })).toEqual(current);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  120_000,
);
