import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { createIsolatedBridge } from "../../src/server/isolated-bridge.js";
import { SDK_VERSION } from "../../src/server/runtime.js";

const wireSchema = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  params: z
    .object({
      providerThreadId: z.string().optional(),
      deltas: z
        .array(
          z.object({
            kind: z.string(),
            status: z.string().optional(),
            text: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

test.skipIf(process.env.CURSOR_SDK_LIVE_RECOVERY !== "1")(
  "a real conversation survives child death, legacy migration, and offline model discovery",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cursor-recovery-live-"));
    const pluginRoot = resolve(import.meta.dirname, "../..");
    const runtime = join(directory, `runtime-${SDK_VERSION}`, "node_modules/@cursor");
    await mkdir(runtime, { recursive: true });
    await symlink(
      await realpath(join(pluginRoot, "node_modules/@cursor/sdk")),
      join(runtime, "sdk"),
    );
    const wrapper = join(directory, "host.mjs");
    await writeFile(
      wrapper,
      `
      import { createSdkBridge as create } from ${JSON.stringify(pathToFileURL(join(pluginRoot, "dist/host.js")).href)};
      import { existsSync } from "node:fs";
      import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))};
      import * as sdk from ${JSON.stringify(import.meta.resolve("@cursor/sdk"))};
      export function createSdkBridge(deps, write) {
        if (existsSync(${JSON.stringify(join(directory, "offline-catalog"))})) {
          deps.load = () => Effect.succeed({ ...sdk, Cursor: { ...sdk.Cursor, models: { list: async () => { throw new Error("Catalog intentionally offline"); } } } });
        }
        const bridge = create(deps, write);
        return { ...bridge, handleLine(line) {
          if (JSON.parse(line).method === "test/crash") process.exit(1);
          bridge.handleLine(line);
        }};
      }
    `,
    );

    const messages: z.infer<typeof wireSchema>[] = [];
    const listeners = new Set<() => void>();

    const bridge = createIsolatedBridge(pathToFileURL(wrapper).href, (line) => {
      messages.push(wireSchema.parse(JSON.parse(line)));

      for (const listener of listeners) listener();
    });

    bridge.start?.({ pluginId: "cursor-sdk", dataDir: directory, tempDir: directory });

    const waitFor = (stage: string, predicate: () => boolean) =>
      new Promise<void>((resolveWait, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check);
          const received = messages.map((m) => m.method ?? `response:${m.id}`).join(", ");
          reject(new Error(`Live recovery timed out during ${stage}. Received: ${received}`));
        }, 100_000);

        const check = () => {
          if (!predicate()) return;
          clearTimeout(timer);
          listeners.delete(check);
          resolveWait();
        };

        listeners.add(check);
        check();
      });

    let sequence = 0;

    const request = async (method: string, params: z.infer<ReturnType<typeof z.json>>) => {
      const id = ++sequence;
      bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      await waitFor(method, () => messages.some((m) => m.id === id));

      return messages.find((m) => m.id === id);
    };

    const options = {
      model: "composer-2.5",
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
      providerOptions: { profile: "personal", runtime: "local" },
    };

    try {
      await request("initialize", {
        protocolVersion: 2,
        client: { name: "live-test", version: "1" },
        grammarVersions: [2, 3],
      });
      expect(
        (
          await request("thread/start", {
            threadId: "live",
            cwd: directory,
            instructionMode: "append",
            options,
          })
        )?.error,
      ).toBeUndefined();

      const identity = z
        .object({ providerThreadId: z.string() })
        .parse(messages.find((m) => m.method === "thread/identity")?.params).providerThreadId;

      const turn = (text: string, clientRequestId: string) =>
        request("turn/start", {
          threadId: "live",
          providerThreadId: identity,
          clientRequestId,
          input: [{ type: "text", text, mentions: [] }],
          options,
        });

      expect(
        (
          await turn(
            "Remember the exact marker RECOVERY_CEDAR_7319. Reply only OK. Do not use any tools.",
            "creq_abcdefghij",
          )
        )?.error,
      ).toBeUndefined();
      await waitFor("first turn completion", () =>
        messages.some((m) => m.params?.deltas?.some((d) => d.kind === "turn.boundary")),
      );
      expect(
        messages.flatMap((m) => m.params?.deltas ?? []).filter((d) => d.kind === "turn.boundary"),
      ).toEqual([expect.objectContaining({ status: "completed" })]);
      expect((await request("test/crash", { threadId: "live" }))?.error).toBeDefined();

      // Recreate the old shared-store layout from this test's real checkpoint.
      // Only temporary test data is changed; production conversations are untouched.
      const profileRoot = join(directory, "conversations", "personal");

      const locationFile = join(
        profileRoot,
        "locations",
        (await readdir(join(profileRoot, "locations")))[0],
      );

      const location = z
        .object({ directory: z.string().uuid() })
        .parse(JSON.parse(await readFile(locationFile, "utf8")));

      const savedFiles = new Set(await readdir(join(profileRoot, "sessions", location.directory)));

      for (const name of Object.values(JSONL_LOCAL_AGENT_STORE_FILES))
        if (savedFiles.has(name))
          await copyFile(
            join(profileRoot, "sessions", location.directory, name),
            join(profileRoot, name),
          );
      await rm(locationFile);

      const legacyAgents = await readFile(
        join(profileRoot, JSONL_LOCAL_AGENT_STORE_FILES.agents),
        "utf8",
      );

      await writeFile(join(directory, "offline-catalog"), "offline");
      messages.splice(0);
      expect(
        (
          await turn(
            "What exact marker did I give you? Reply only with that marker. Do not use any tools.",
            "creq_bcdefghijk",
          )
        )?.error,
      ).toBeUndefined();
      await waitFor("resumed turn completion", () =>
        messages.some((m) => m.params?.deltas?.some((d) => d.kind === "turn.boundary")),
      );
      expect(messages.find((m) => m.method === "thread/identity")?.params?.providerThreadId).toBe(
        identity,
      );
      expect(
        messages.flatMap((m) => m.params?.deltas ?? []).filter((d) => d.kind === "turn.boundary"),
      ).toEqual([expect.objectContaining({ status: "completed" })]);
      expect(
        messages
          .flatMap((m) => m.params?.deltas ?? [])
          .flatMap((d) => (d.kind === "item.textDelta" ? [d.text] : []))
          .join(""),
      ).toContain("RECOVERY_CEDAR_7319");
      expect(await readdir(join(profileRoot, "locations"))).toHaveLength(1);
      expect(await readFile(join(profileRoot, JSONL_LOCAL_AGENT_STORE_FILES.agents), "utf8")).toBe(
        legacyAgents,
      );
    } finally {
      await bridge.onClose();
      await rm(directory, { recursive: true, force: true });
    }
  },
  240_000,
);
