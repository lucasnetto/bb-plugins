import { registerIncusProvider } from "./incus-provider.ts";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { registerPersistentProvider } from "./persistent-provider.ts";
import { registerTaskProvider } from "./task-provider.ts";

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    persistentRuntimeIdleMinutes: {
      type: "number",
      label: "Release idle agent runtimes after (minutes)",
      description: "Keep persistent VMs connected while unloading idle agents. Set 0 to disable.",
      default: 10,
      experimental_schema: z.number().int().min(0).max(1440),
    },
    persistentIdleMinutes: {
      type: "number",
      label: "Suspend persistent VMs after idle (minutes)",
      description: "Keep their files and resume automatically. Set 0 to disable idle suspension.",
      default: 0,
      experimental_schema: z.number().int().min(0).max(1440),
    },
    taskTemplate: {
      type: "string",
      label: "Task VM template",
      description: "Clean isolated OrbStack template for dedicated BB task VMs.",
      default: "cursor-base",
      experimental_schema: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    },
    taskIdleMinutes: {
      type: "number",
      label: "Suspend task VMs after idle (minutes)",
      description:
        "Preserve the disk while idle. Set 0 to disable idle suspension. Settling still deletes after 10 minutes.",
      default: 15,
      experimental_schema: z.number().int().min(0).max(1440),
    },
  });

  const taskPolicy = registerTaskProvider(bb, () => settings.get());
  registerPersistentProvider(bb, () => settings.get());
  registerIncusProvider(bb);
  bb.cli.register({
    name: "orbisa",
    summary: "Inspect Orbisa task machine lifecycle",
    commands: [
      {
        name: "tasks",
        summary: "Show task VM lifecycle and deletion deadlines",
        usage: "bb orbisa tasks",
      },
    ],
    async run(argv) {
      try {
        if (argv[0] === "tasks" && argv.length === 1) {
          const hosts = (await bb.sdk.hosts.list({ includeCreating: true })).filter(
            (host) => host.machineProviderId === "orbisa-task",
          );

          return {
            exitCode: 0,
            stdout: JSON.stringify(
              {
                total: hosts.length,
                machines: await Promise.all(
                  hosts.slice(0, 100).map(async (host) => ({
                    id: host.id,
                    name: host.name,
                    phase: host.lifecycle.phase,
                    status: host.status,
                    ...(await taskPolicy.read(host.id)),
                  })),
                ),
              },
              null,
              2,
            ),
          };
        }

        throw new Error("Usage: bb orbisa tasks");
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
