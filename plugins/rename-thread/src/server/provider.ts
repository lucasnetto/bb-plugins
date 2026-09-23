import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { z } from "zod";
import type { ModelSelection } from "../shared/contract";
import { normalizeTitle } from "./codex";
import { call, sync } from "./effects";

const resultSchema = z.object({ title: z.string().min(1).max(500) }).strict();

export function parseProviderTitle(output: string | null): string {
  const json = (output ?? "").trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");

  return normalizeTitle(resultSchema.parse(JSON.parse(json)).title);
}

// The picker resolves on the primary machine. Spawn there in an empty workspace,
// with the profile's own provider authentication and no target conversation turn.
export const generateProviderTitle = Effect.fn("Rename.generateProviderTitle")(function* (
  bb: BbPluginApi,
  prompt: string,
  selection: ModelSelection,
) {
  const providers = yield* call("title provider capabilities", () => bb.sdk.providers.list());

  const permissionMode = yield* sync("resolve title helper permissions", () => {
    const provider = providers.find((item) => item.id === selection.providerId && item.available);
    const modes = provider?.capabilities.permissionModes;

    if (!modes?.length) throw new Error("The selected title provider is unavailable.");

    return modes.includes("accept-edits")
      ? "accept-edits"
      : modes.includes("auto")
        ? "auto"
        : modes[0];
  });

  const projects = yield* call("title helper project", () =>
    bb.sdk.projects.list({ includePersonal: true }),
  );

  const project = yield* sync("resolve title helper project", () => {
    const personal = projects.find((item) => item.kind === "personal");

    if (!personal) throw new Error("Personal workspace is unavailable.");

    return personal;
  });

  return yield* Effect.acquireUseRelease(
    call("start title helper", () =>
      bb.sdk.threads.spawn({
        projectId: project.id,
        environment: { type: "host", workspace: { type: "personal" } },
        ...selection,
        permissionMode,
        visibility: "hidden",
        title: "Generate thread title",
        prompt,
      }),
    ),
    (worker) =>
      Effect.gen(function* () {
        while (true) {
          const state = yield* call("title helper status", (signal) =>
            bb.sdk.threads.get({ threadId: worker.id, signal }),
          );

          if (state.deletedAt || state.archivedAt || state.status === "error")
            return yield* sync("title helper failed", () => {
              throw new Error("Title helper failed.");
            });

          if (state.status === "idle") break;
          yield* Effect.sleep("500 millis");
        }

        const { output } = yield* call("title helper output", (signal) =>
          bb.sdk.threads.output({ threadId: worker.id, signal }),
        );

        return yield* sync("validate provider title", () => parseProviderTitle(output));
      }).pipe(Effect.timeout("120 seconds")),
    (worker) =>
      call("stop title helper", () => bb.sdk.threads.stop({ threadId: worker.id })).pipe(
        Effect.ensuring(
          call("archive title helper", () => bb.sdk.threads.archive({ threadId: worker.id })).pipe(
            Effect.orDie,
          ),
        ),
        Effect.orDie,
      ),
  );
});
