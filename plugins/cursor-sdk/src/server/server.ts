import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { basename } from "node:path";

export default function plugin(bb: BbPluginApi) {
  const directory = basename(bb.server.experimental_dataDir);
  if (directory !== ".bb" && directory !== ".bb-work")
    throw new Error("Cursor SDK requires a configured Personal or Work profile.");
  const profile = directory === ".bb-work" ? "work" : "personal";
  bb.providers.register({
    id: "cursor-sdk",
    displayName: "Cursor SDK",
    icon: "Terminal",
    strings: {
      signInHint: `Restore the ${profile} Cursor API key used by this profile.`,
      expiredHint: `The ${profile} Cursor API key needs attention.`,
      installUrl: "https://cursor.com/docs/sdk/typescript",
    },
    experimental_bridgeOptions: { profile },
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      fork: "none",
      permissionModes: ["full"],
      reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    },
    maintenance: { health: true, usage: false, installation: true },
    models: { scope: "host" },
    serviceTiers: [
      { id: "default", label: "Default" },
      { id: "fast", label: "Fast" },
    ],
    composerActions: ["plan"],
  });
}
