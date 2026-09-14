import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { renameStatusSchema } from "../../shared/rename-contract";
import { call, createRuntime } from "./server-effects";

export function createRenameHandlers(bb: BbPluginApi) {
  const runtime = createRuntime(bb);

  return {
    rename_status: ({ threadId }: { threadId: string }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const { plugins } = yield* call("list plugins", (signal) =>
            bb.sdk.plugins.list({ signal }),
          );

          if (
            !plugins.some(
              (plugin) =>
                plugin.id === "rename-thread" && plugin.enabled && plugin.status === "running",
            )
          )
            return { available: false, job: null };

          const job = yield* call("rename status", () =>
            bb.sdk.plugins.callRpc({
              pluginId: "rename-thread",
              method: "status",
              input: { threadId },
              outputSchema: renameStatusSchema,
            }),
          );

          return { available: true, job };
        }),
      ),
    rename_start: ({ threadId }: { threadId: string }) =>
      runtime.runPromise(
        call("start rename", () =>
          bb.sdk.plugins.callRpc({
            pluginId: "rename-thread",
            method: "start",
            input: { threadId },
            outputSchema: renameStatusSchema,
          }),
        ),
      ),
  };
}
