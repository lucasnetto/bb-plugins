import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { join } from "node:path";
import { homedir } from "node:os";
import { rpcContract } from "./contract.ts";
import { cursorProvider } from "./cursor.ts";
import { profileProviderIds, resolveProfile } from "./profile.ts";
import { defineSettings } from "./settings.ts";
import { cacheAdministration } from "./administration.ts";
import { maintenanceContract } from "./refresh-contract.ts";
import { runRefresh } from "./refresh-runner.ts";
import { maintain } from "./refresh-host.ts";

export default async function plugin(bb: BbPluginApi) {
  const settings = defineSettings(bb);
  const initial = await settings.get();
  let cache = Promise.resolve();

  const saveCache = (values: typeof initial) => {
    cache = cache
      .then(() => cacheAdministration(values))
      .catch(() => {
        bb.log.warn("Could not update the desktop restart settings snapshot.");
      });
  };

  if (initial.personalLocalUrl && initial.workLocalUrl) saveCache(initial);
  settings.onChange(saveCache);
  bb.onDispose(() => cache);

  const profile = resolveProfile(bb.server.experimental_dataDir);
  const allowedProviders = new Set(profileProviderIds(profile));

  const info = async () => {
    const values = await settings.get();

    return {
      current: profile,
      profiles: (["personal", "work"] as const).flatMap((id) => {
        const url = values[`${id}Url`];
        const localUrl = values[`${id}LocalUrl`];

        return url || localUrl
          ? [
              {
                id,
                name: id === "personal" ? "Personal" : "Work",
                email: values[`${id}Email`],
                url,
                localUrl,
              },
            ]
          : [];
      }),
    };
  };

  const command =
    profile === "personal"
      ? join(homedir(), ".local/bin/cursor-agent-personal-acp")
      : "bb-cursor-work-acp";

  bb.providers.register(cursorProvider(profile, "acp-cursor", command));

  if (profile === "personal") {
    bb.providers.register(cursorProvider(profile, "acp-cursor-personal", command));
  }

  bb.rpc.register(rpcContract, { info });
  bb.agents.contributeInstructions(
    () =>
      `This is the ${profile === "work" ? "Work" : "Personal"} bb instance. Use normal bb commands with the supplied BB_SERVER_URL. Children belong to this same instance. Do not change server URLs or account credentials to switch profiles. For authorized plugin maintenance across both profiles, use bb profiles refresh [plugin-id ...]; this bounded administrative command preserves the current thread and each account. Use --check for installation paths, build versions, and health.`,
  );
  bb.experimental_hooks.on("message.dispatch", ({ requestedExecution }) => {
    if (!allowedProviders.has(requestedExecution.providerId)) {
      return {
        action: "reject",
        message: `This ${profile} instance supports Codex, Claude Code, Cursor, and Pi. Select one of those providers.`,
      };
    }

    return { action: "proceed" };
  });
  bb.cli.register({
    name: "profiles",
    summary: "Show this instance's account profile and the other profile's address",
    commands: [
      { name: "status", summary: "Show the active profile", usage: "bb profiles status" },
      {
        name: "refresh",
        summary: "Refresh installed plugins across repositories in both profiles",
        usage:
          "bb profiles refresh [plugin-id ...] [--check | --install-missing | --source <absolute-directory>]",
      },
    ],
    async run(argv) {
      if (argv[0] === "refresh") {
        const args = argv.slice(1);
        const sourceIndex = args.indexOf("--source");
        const sourcePath = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;

        const remaining =
          sourceIndex >= 0 ? [...args.slice(0, sourceIndex), ...args.slice(sourceIndex + 2)] : args;

        if (
          (sourceIndex >= 0 && (!sourcePath?.startsWith("/") || remaining.length !== 1)) ||
          remaining.some(
            (arg) =>
              arg !== "--check" && arg !== "--install-missing" && !/^[a-z][a-z0-9-]*$/.test(arg),
          )
        )
          return {
            exitCode: 1,
            stderr:
              "Usage: bb profiles refresh [plugin-id ...] [--check | --install-missing | --source <absolute-directory>]",
          };
        const self = (await bb.sdk.plugins.list()).plugins.find((p) => p.id === bb.pluginId);

        if (!self) return { exitCode: 1, stderr: "Profiles installation is missing." };

        const values = await settings.get();
        const { primaryHostId } = await bb.sdk.system.config();

        const hosts = Object.fromEntries(
          (["personal", "work"] as const).map((id) => [
            id,
            String(values[`${id}HostId`] || primaryHostId || ""),
          ]),
        );

        return runRefresh(
          join(self.rootDir, "refresh.py"),
          argv.slice(1),
          { ...values, refreshCurrentProfile: profile },
          hosts,
          async (request) => {
            const id = request.profile;

            if (!hosts[id]) throw new Error("Configure an administration machine.");

            if (
              request.action === "reload" &&
              request.argument === bb.pluginId &&
              id === profile &&
              hosts[id] === primaryHostId
            ) {
              // Reloading this host worker would destroy the reply channel. Core owns self-reload.
              await bb.sdk.plugins.reload({ pluginId: bb.pluginId });

              return "";
            }

            const target = {
              ...request,
              url: values[`${id}LocalUrl`],
              cliPath: values[`${id}CliPath`],
              dataDir:
                values[`${id}DataDir`] ||
                (id === profile && hosts[id] === primaryHostId
                  ? bb.server.experimental_dataDir
                  : ""),
            };

            if (hosts[id] === primaryHostId) return maintain(target);
            const host = bb.hosts.experimental_client({ contract: maintenanceContract });

            return host.call("maintain", target, {
              hostId: hosts[id],
              signal: AbortSignal.timeout(
                request.action === "build" || request.action === "install" ? 310_000 : 30_000,
              ),
            });
          },
        );
      }

      if (argv.length !== 1 || argv[0] !== "status") {
        return { exitCode: 1, stderr: "Usage: bb profiles status" };
      }

      return { exitCode: 0, stdout: JSON.stringify(await info(), null, 2) };
    },
  });
}
