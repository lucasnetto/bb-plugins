import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import type { Profile } from "./contract.ts";

export function cursorProvider(
  profile: Profile,
  id: string,
  command: string,
): PluginProviderDeclaration {
  const personal = profile === "personal";
  const roots = [".cursor/skills", ".agents/skills", ".claude/skills", ".codex/skills"];

  return {
    id,
    displayName: id === "acp-cursor-personal" ? "Cursor Personal" : "Cursor",
    family: "acp",
    icon: "Terminal",
    strings: {
      signInHint: personal
        ? "Restore the Personal Cursor API key in macOS Keychain."
        : "Restore the dedicated Work Cursor API key.",
      expiredHint: personal
        ? "The Personal Cursor API key needs attention."
        : "The Work Cursor API key needs attention.",
      installUrl: "https://cursor.com/docs/cli/installation",
    },
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      fork: "none",
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    },
    maintenance: { health: true, usage: false, installation: false },
    models: { scope: "host" },
    serviceTiers: [
      { id: "default", label: "Default" },
      { id: "fast", label: "Fast" },
    ],
    experimental_nativeSkillRoots: {
      user: roots.map((path) => ({ path, recursive: true })),
      project: roots.map((path) => ({ path, recursive: true, ancestors: true })),
    },
    experimental_bridgeOptions: {
      acpDialect: "cursor",
      parameterizedModelPicker: true,
      // Work advertises Auto but rejects both aliases when selected over ACP.
      excludedCursorModelIds: personal ? [] : ["auto", "default"],
      acpLaunchSpec: {
        displayName: "Cursor",
        command,
        args: [],
        env: {},
        modelCli: { listArgs: ["--list-models"], primaryModels: [] },
      },
    },
    composerActions: [],
  };
}
