import { expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { generateTitle, profileCodexHome } from "../../src/server/codex";
import { titlePrompt } from "../../src/server/context";
import { defaultModelSelection } from "../../src/shared/contract";

it.skipIf(process.env.RUN_RENAME_LIVE !== "1")(
  "generates a title with the Work Codex login",
  async () => {
    const title = await Effect.runPromise(
      generateTitle(
        titlePrompt(
          "Untitled",
          "USER: Add a right-click action to automatically rename a conversation from its original goal and recent messages.",
        ),
        defaultModelSelection,
        profileCodexHome("/tmp/.bb-work", undefined),
      ),
    );

    expect(title.length).toBeGreaterThan(0);
    expect(title.toLowerCase()).toMatch(/thread|conversation|renam|title/);
  },
  75000,
);
