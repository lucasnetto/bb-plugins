import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { basename } from "node:path";
import { Effect } from "effect";
import { foreign } from "./operations.js";
import { rpcContract, RUNTIME_CHANGED } from "../shared/runtime-settings.js";

export default function plugin(bb: BbPluginApi) {
  const directory = basename(bb.server.experimental_dataDir);

  if (directory !== ".bb" && directory !== ".bb-work")
    throw new Error("Cursor SDK requires a configured Personal or Work profile.");
  const profile = directory === ".bb-work" ? "work" : "personal";

  const settings = bb.settings.define({
    cloudAgents: {
      type: "boolean",
      label: "Cloud agents",
      description:
        "Run new Cursor SDK threads on Cursor Cloud. Off runs locally. Existing conversations keep their original runtime. Cloud requires a clean, pushed GitHub commit.",
      default: false,
    },
  });

  settings.onChange((next) => bb.realtime.publish(RUNTIME_CHANGED, next));
  bb.rpc.register(rpcContract, {
    runtimeGet: () => Effect.runPromise(foreign(() => settings.get())),
    runtimeSet: (value) => Effect.runPromise(foreign(() => settings.experimental_set(value))),
  });
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
    deriveProviderOptions: ({ settings }) => ({
      runtime: settings.cloudAgents === true ? "cloud" : "local",
    }),
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
