import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
  "a real SDK conversation survives child death and recalls its previous turn",
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
      export function createSdkBridge(deps, write) {
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
    } finally {
      await bridge.onClose();
      await rm(directory, { recursive: true, force: true });
    }
  },
  240_000,
);
