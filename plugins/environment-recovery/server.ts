import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import { createRecovery } from "./recovery";

export default function plugin(bb: BbPluginApi) {
  const recovery = createRecovery(bb);
  bb.rpc.register(rpcContract, {
    preview: (input) => recovery.preview(input),
    recover: (input) => recovery.recover(input),
  });
  bb.onDispose(() => recovery.close());

  const positionals = [
    { name: "thread", description: "Original thread ID", required: true },
  ] as const;

  const options = {
    branch: {
      type: "string",
      description: "Surviving local or remote branch; defaults to the recorded branch",
    },
    json: { type: "boolean", description: "Print JSON" },
  } as const;

  bb.cli.register(
    defineCli({
      name: "environment-recovery",
      summary: "Recover a removed workspace from a surviving branch",
      commands: {
        preview: cliCommand({
          summary: "Check the recovery branch and machine without creating anything",
          positionals,
          options,
          async run(input) {
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                await recovery.preview({
                  threadId: input.positionals.thread,
                  branch: input.options.branch,
                }),
              ),
            };
          },
        }),
        recover: cliCommand({
          summary: "Restore the original workspace, or create a continuation on another branch",
          positionals,
          options,
          async run(input) {
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                await recovery.recover({
                  threadId: input.positionals.thread,
                  branch: input.options.branch,
                }),
              ),
            };
          },
        }),
      },
    }),
  );
}
