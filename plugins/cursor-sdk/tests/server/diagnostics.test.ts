import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import hostEntry from "../../src/server/host.js";
import plugin from "../../src/server/server.js";
import { recordDiagnostic } from "../../src/server/diagnostics.js";
import { SDK_VERSION, bridgeDirectoryFromRuntime } from "../../src/server/runtime.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

test("host diagnostics find the bridge's own directory and cap persisted events", async () => {
  const root = await mkdtemp(join(tmpdir(), "cursor-diagnostics-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtimePackagePath = join(root, `runtime-${SDK_VERSION}/node_modules/@cursor/sdk`);
  expect(bridgeDirectoryFromRuntime(runtimePackagePath)).toBe(root);
  expect(() => bridgeDirectoryFromRuntime(join(root, "other"))).toThrow("layout");

  for (let i = 0; i < 90; i++)
    recordDiagnostic(root, "../thread", {
      phase: "agent-resume",
      state: "succeeded",
      durationMs: i,
    });

  const harness = experimental_createHostEntryHarness(hostEntry, {
    experimental_paths: { dataDir: join(root, "different-host-data"), tempDir: root },
  });

  cleanup.push(() => harness.experimental_dispose());

  const result = await harness.experimental_call("diagnostics", {
    threadId: "../thread",
    runtimePackagePath,
  });

  expect(result).toHaveLength(80);
  expect(result[0].durationMs).toBe(10);
  expect(result[79].durationMs).toBe(89);
  const files = await readdir(join(root, "diagnostics"));
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
  const record = JSON.parse(await readFile(join(root, "diagnostics", files[0]), "utf8"))[0];
  expect(Object.keys(record).sort()).toEqual(["at", "durationMs", "phase", "pid", "state"]);
});

test("diagnostics CLI routes to the thread's machine using the public provider installation path", async () => {
  const runtimePackagePath = `/remote/plugin-data/runtime-${SDK_VERSION}/node_modules/@cursor/sdk`;

  const { bb, harness } = createFakePluginHost({
    pluginId: "cursor-sdk",
    dataDir: "/tmp/.bb",
    experimental_callHostRpc: async (call) => {
      expect(call.hostId).toBe("remote-host");
      expect(call.input).toEqual({ threadId: "source", runtimePackagePath });

      return [];
    },
    sdk: {
      threads: {
        get: async () =>
          makeThreadResponse({
            id: "source",
            providerId: "cursor-sdk",
            environmentId: "environment",
          }),
      },
      environments: {
        get: async () => ({
          id: "environment",
          hostId: "remote-host",
          projectId: "project",
          path: "/workspace",
          name: null,
          status: "ready",
          createdAt: 1,
          updatedAt: 1,
          managed: false,
          isGitRepo: true,
          isWorktree: false,
          branchName: "main",
          defaultBranch: "main",
          mergeBaseBranch: null,
          workspaceProvisionType: "unmanaged",
        }),
      },
      hosts: {
        providerCliStatus: async () => ({
          "cursor-sdk": {
            currentVersion: SDK_VERSION,
            displayName: "Cursor SDK",
            executableName: "@cursor/sdk",
            executablePath: runtimePackagePath,
            installAction: null,
            installSource: "external",
            installed: true,
            latestVersion: SDK_VERSION,
            minimumSupportedVersion: SDK_VERSION,
            needsUpdate: false,
            npmGlobalPackageVersion: null,
            npmPackageName: "@cursor/sdk",
            versionUnsupported: false,
          },
        }),
      },
    },
  });

  cleanup.push(() => harness.lifecycle.dispose());
  plugin(bb);
  const result = await harness.behavior.runCli(["diagnostics", "source", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    threadId: "source",
    hostId: "remote-host",
    events: [],
  });
});
