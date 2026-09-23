import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerOrbisaProvider } from "./provider.ts";

export default function plugin(bb: BbPluginApi) {
  const policy = registerOrbisaProvider(bb);
  bb.cli.register({
    name: "orbisa",
    summary: "Inspect Orbisa environments and cleanup deadlines",
    commands: [
      {
        name: "machines",
        summary: "Show Orbisa lifecycle and deletion deadlines",
        usage: "bb orbisa machines",
      },
    ],
    async run(argv) {
      try {
        if (argv.length !== 1 || argv[0] !== "machines")
          throw new Error("Usage: bb orbisa machines");
        const hosts = (await bb.sdk.hosts.list({ includeCreating: true })).filter(
          (h) => h.machineProviderId === "orbisa-machine",
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
                  ...(await policy.read(host.id)),
                })),
              ),
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
