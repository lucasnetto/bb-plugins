import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import { diagnosticsHostContract } from "../shared/diagnostics.js";
import { createRecovery } from "./recovery.js";
import { safeMessage } from "./operations.js";

export function registerReliabilityCommands(bb: BbPluginApi) {
  const recovery = createRecovery(bb);
  bb.onDispose(() => recovery.close());
  const host = bb.hosts.experimental_client({ contract: diagnosticsHostContract });

  bb.cli.register({
    name: "cursor-sdk",
    summary: "Recover Cursor conversations and inspect startup failures",
    commands: [
      {
        name: "recover",
        summary: "Create a fresh conversation from BB's saved history; preserves the original",
        usage: "bb cursor-sdk recover <thread-id> [--preview] [--new] [--json]",
      },
      {
        name: "diagnostics",
        summary: "Read the last 80 startup/cleanup events on the thread's machine",
        usage: "bb cursor-sdk diagnostics <thread-id> [--json]",
      },
    ],
    async run(argv, context) {
      const [command, threadId, ...flags] = argv;

      if (
        !threadId ||
        threadId.startsWith("-") ||
        !["recover", "diagnostics"].includes(command) ||
        new Set(flags).size !== flags.length ||
        flags.some(
          (flag) =>
            flag !== "--json" && !(command === "recover" && ["--preview", "--new"].includes(flag)),
        ) ||
        (flags.includes("--preview") && flags.includes("--new"))
      )
        return {
          exitCode: 1,
          stderr:
            "Usage: bb cursor-sdk recover <thread-id> [--preview | --new] [--json] | diagnostics <thread-id> [--json]",
        };

      try {
        if (command === "recover") {
          const value = flags.includes("--preview")
            ? await recovery.preview(threadId, context.signal)
            : await recovery.recover(threadId, flags.includes("--new"));

          return { exitCode: 0, stdout: JSON.stringify(value, null, 2) };
        }

        const thread = await bb.sdk.threads.get({ threadId, signal: context.signal });

        if (thread.providerId !== "cursor-sdk" || !thread.environmentId)
          throw new Error("Select a Cursor SDK thread with an existing environment.");

        const environment = await bb.sdk.environments.get({
          environmentId: thread.environmentId,
          signal: context.signal,
        });

        const installations = await bb.sdk.hosts.providerCliStatus({
          hostId: environment.hostId,
          signal: context.signal,
        });

        const runtimePackagePath = installations["cursor-sdk"]?.executablePath;

        if (!runtimePackagePath)
          throw new Error(
            "Cursor SDK is not installed on this thread's machine. Install it in Settings → Providers before reading startup diagnostics.",
          );

        const events = await host.call(
          "diagnostics",
          { threadId, runtimePackagePath },
          { hostId: environment.hostId, signal: context.signal },
        );

        return {
          exitCode: 0,
          stdout: JSON.stringify({ threadId, hostId: environment.hostId, events }, null, 2),
        };
      } catch (error) {
        const message = safeMessage(error);

        const result: PluginCliResult = {
          exitCode: 1,
          stderr: message,
        };

        if (flags.includes("--json"))
          result.stdout = JSON.stringify({ ok: false, error: { message } });

        return result;
      }
    },
  });
}
