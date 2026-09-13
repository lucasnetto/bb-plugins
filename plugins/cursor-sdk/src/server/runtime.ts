import type * as CursorSdk from "@cursor/sdk";
import type {
  ProviderInstallationStatus,
  ProviderInstallationCommand,
} from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_formatCommand } from "@get-bb/plugin-sdk/provider-bridge";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { z } from "zod";
import { SdkError, foreign } from "./operations.js";

export const SDK_VERSION = "1.0.31";

export type SdkModule = {
  Agent: Pick<typeof CursorSdk.Agent, "create" | "resume" | "get">;
  Cursor: Pick<typeof CursorSdk.Cursor, "me" | "models">;
  JsonlLocalAgentStore: typeof CursorSdk.JsonlLocalAgentStore;
};

const runtimeDir = (dataDir: string) => join(dataDir, `runtime-${SDK_VERSION}`);

const packageDir = (dataDir: string) => join(runtimeDir(dataDir), "node_modules/@cursor/sdk");

export function installCommand(dataDir: string): ProviderInstallationCommand {
  const args = [
    "install",
    "--prefix",
    runtimeDir(dataDir),
    "--cache",
    join(dataDir, "npm-cache"),
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    `@cursor/sdk@${SDK_VERSION}`,
  ];

  return { command: "npm", args, displayCommand: experimental_formatCommand("npm", args) };
}

export const installationStatus = Effect.fn("CursorSdk.installationStatus")(function* (
  dataDir: string,
) {
  const version = yield* foreign(() =>
    readFile(join(packageDir(dataDir), "package.json"), "utf8"),
  ).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => z.object({ version: z.string() }).parse(JSON.parse(text)).version,
        catch: () => new SdkError({ message: "Invalid Cursor SDK installation manifest." }),
      }),
    ),
    Effect.catch(() => Effect.succeed(null)),
  );

  const installed = version === SDK_VERSION;

  return {
    installed,
    currentVersion: version,
    latestVersion: SDK_VERSION,
    executableName: "@cursor/sdk",
    executablePath: installed ? packageDir(dataDir) : null,
    installSource: installed ? "external" : "notInstalled",
    installAction: installed
      ? null
      : { command: installCommand(dataDir).displayCommand, kind: "install", label: "Install" },
    minimumSupportedVersion: SDK_VERSION,
    needsUpdate: version !== null && !installed,
    npmGlobalPackageVersion: null,
    npmPackageName: "@cursor/sdk",
    versionUnsupported: version !== null && !installed,
  } satisfies ProviderInstallationStatus;
});

export const loadSdk = Effect.fn("CursorSdk.loadSdk")(function* (dataDir: string) {
  if (!(yield* installationStatus(dataDir)).installed) {
    return yield* Effect.fail(
      new SdkError({
        message:
          "Install Cursor SDK in Settings → Providers, or run bb machine provider-cli install <host-id> cursor-sdk.",
      }),
    );
  }

  // Keep the published package intact: its local runtime loads adjacent chunks
  // and platform helpers. A variable import prevents BB's single-file builder
  // from rewriting those package-relative imports.
  const url = pathToFileURL(join(packageDir(dataDir), "dist/esm/index.js")).href;
  const module: SdkModule = yield* foreign(() => import(/* @vite-ignore */ url));

  return module;
});
