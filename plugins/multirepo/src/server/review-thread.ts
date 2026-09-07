import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { hostContract } from "../shared/contract";
import { parsePrUrl } from "../shared/links-contract";
import { call, sync, type BackendError } from "./server-effects";
import type { registerLinks } from "./links-server";

type Workspace = { root: string; hostId: string; projectId: string; name: string };

/** Public URL-based entry for PR browsers; Multirepo owns the review workflow. */
export function createReviewThread(
  bb: BbPluginApi,
  workspace: () => Effect.Effect<Workspace, BackendError>,
  links: Pick<ReturnType<typeof registerLinks>, "linkedLink">,
) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  return Effect.fn("Multirepo.reviewUrl")(function* ({ url }: { url: string }) {
    const ref = yield* sync("review URL", () => parsePrUrl(url));
    const w = yield* workspace();
    // Verify access and fetch the title before creating any thread.
    const pr = yield* call("host.linkedSummary", (signal) =>
      host.call("linkedSummary", { root: w.root, url: ref.url }, { hostId: w.hostId, signal }),
    );
    const thread = yield* call("threads.spawn", () =>
      bb.sdk.threads.spawn({
        projectId: w.projectId,
        environment: {
          type: "host",
          hostId: w.hostId,
          workspace: { type: "unmanaged", path: w.root },
        },
        title: `${ref.repository}#${ref.number}: ${pr.title}`,
        prompt: [
          `Review ${ref.url}.`,
          `Use Multirepo's linked PR review flow. Link this PR with reason requested-review if it is not already linked.`,
          `The umbrella workspace is ${JSON.stringify(w.root)}. Find the repository locally if available; the PR may also belong to a repository outside this workspace.`,
          `Read the PR using gh pr view ${ref.number} -R ${ref.repository} --comments and gh pr diff ${ref.number} -R ${ref.repository}.`,
          "Inspect the exact PR revisions, not unrelated local changes. Review correctness, regressions, and missing tests. Return findings with file/line references.",
          "Preserve all existing work; do not switch the shared checkout, edit files, push, or post to GitHub unless the user asks.",
        ].join("\n"),
      }),
    );
    // A link failure must still return the created thread: retrying the button
    // should not silently create another agent run after a successful spawn.
    const warning = yield* links
      .linkedLink({ threadId: thread.id, url: ref.url, reason: "requested-review" })
      .pipe(
        Effect.as(null as string | null),
        Effect.catchTag("BackendError", (error) =>
          Effect.succeed(
            `Review thread created, but linking the PR failed: ${error.message}. The agent can retry linking it.`,
          ),
        ),
      );
    return { threadId: thread.id, warning };
  });
}
