import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { rpcContract } from "./contract.ts";
import { cursorProvider } from "./cursor.ts";
import { profileProviderIds, resolveProfile } from "./profile.ts";

export default function plugin(bb: BbPluginApi) {
  const profile = resolveProfile(bb.server.experimental_dataDir);
  const allowedProviders = new Set(profileProviderIds(profile));
  const info = {
    current: profile,
    profiles: [
      {
        id: "personal" as const,
        name: "Personal",
        email: "personal@example.com",
        url: "https://personal.example.com",
        localUrl: "http://127.0.0.1:38886",
      },
      {
        id: "work" as const,
        name: "Work",
        email: "work@example.com",
        url: "https://work.example.com",
        localUrl: "http://127.0.0.1:48886",
      },
    ],
  };
  const personalCommand = join(homedir(), ".local/bin/cursor-agent-personal-acp");
  bb.providers.register(cursorProvider(profile, "acp-cursor", personalCommand));
  if (profile === "personal") {
    // Preserve the provider ID persisted on existing Personal conversations.
    bb.providers.register(cursorProvider(profile, "acp-cursor-personal", personalCommand));
  }
  bb.rpc.register(rpcContract, { info: () => info });
  bb.agents.contributeInstructions(
    () =>
      `This is the ${profile === "work" ? "Work" : "Personal"} bb instance. Use normal bb commands with the supplied BB_SERVER_URL. Children belong to this same instance. Do not change server URLs or account credentials to switch profiles. For authorized plugin maintenance across both profiles, use bb profiles refresh [plugin-id ...]; this bounded administrative command preserves the current thread and each account. Use --check for installation paths, build versions, and health.`,
  );
  bb.experimental_hooks.on("message.dispatch", ({ requestedExecution }) => {
    if (!allowedProviders.has(requestedExecution.providerId)) {
      return {
        action: "reject",
        message: `This ${profile} instance supports Codex and Cursor with its own accounts. Select one of those providers.`,
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
        summary: "Build and refresh local bb-plugins plugins in both profiles",
        usage: "bb profiles refresh [plugin-id ...] [--check]",
      },
    ],
    async run(argv) {
      if (argv[0] === "refresh") {
        if (argv.slice(1).some((arg) => arg !== "--check" && !/^[a-z][a-z0-9-]*$/.test(arg)))
          return { exitCode: 1, stderr: "Usage: bb profiles refresh [plugin-id ...] [--check]" };
        const self = (await bb.sdk.plugins.list()).plugins.find((p) => p.id === bb.pluginId);
        if (!self) return { exitCode: 1, stderr: "Profiles installation is missing." };
        try {
          const result = await promisify(execFile)(
            "python3",
            [join(self.rootDir, "refresh.py"), ...argv.slice(1)],
            { timeout: 3_600_000, maxBuffer: 2 * 1024 * 1024 },
          );
          return { exitCode: 0, stdout: result.stdout };
        } catch (error) {
          const result = error as { stdout?: string; stderr?: string };
          return {
            exitCode: 1,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "Profile refresh failed; inspect plugin logs.",
          };
        }
      }
      if (argv.length !== 1 || argv[0] !== "status") {
        return { exitCode: 1, stderr: "Usage: bb profiles status" };
      }
      return { exitCode: 0, stdout: JSON.stringify(info, null, 2) };
    },
  });
}
