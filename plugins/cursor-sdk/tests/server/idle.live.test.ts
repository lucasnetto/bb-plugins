import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, vi } from "vite-plus/test";
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
  error: z.object({ message: z.string() }).optional(),
});

test.skipIf(process.env.CURSOR_SDK_LIVE_IDLE !== "1")(
  "a real conversation survives idle process disposal and recalls its saved checkpoint",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cursor-idle-live-"));
    const pluginRoot = resolve(import.meta.dirname, "../..");
    const runtime = join(directory, `runtime-${SDK_VERSION}`, "node_modules/@cursor");
    await mkdir(runtime, { recursive: true });
    await symlink(
      await realpath(join(pluginRoot, "node_modules/@cursor/sdk")),
      join(runtime, "sdk"),
    );
    const wrapper = join(directory, "host.mjs");
    const pids = join(directory, "pids");
    await writeFile(
      wrapper,
      `
      import { createSdkBridge as create } from ${JSON.stringify(pathToFileURL(join(pluginRoot, "dist/host.js")).href)};
      import { appendFileSync } from "node:fs";
      export function createSdkBridge(deps, write) {
        appendFileSync(${JSON.stringify(pids)}, process.pid + "\\n");
        return create(deps, write);
      }
    `,
    );
    const messages: z.infer<typeof wireSchema>[] = [];

    const bridge = createIsolatedBridge(
      pathToFileURL(wrapper).href,
      (line) => {
        messages.push(wireSchema.parse(JSON.parse(line)));
      },
      undefined,
      undefined,
      undefined,
      500,
    );

    bridge.start?.({ pluginId: "cursor-sdk", dataDir: directory, tempDir: directory });
    let sequence = 0;

    const request = async (method: string, params: z.infer<ReturnType<typeof z.json>>) => {
      const id = ++sequence;
      bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      await vi.waitFor(() => expect(messages.some((message) => message.id === id)).toBe(true), {
        timeout: 100_000,
      });
      expect(messages.find((message) => message.id === id)?.error).toBeUndefined();
    };

    const options = {
      model: "composer-2.5",
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
      providerOptions: { profile: "personal", runtime: "local" },
    };

    const finish = async () => {
      await vi.waitFor(
        () =>
          expect(
            messages.some((message) =>
              message.params?.deltas?.some((delta) => delta.kind === "turn.boundary"),
            ),
          ).toBe(true),
        { timeout: 100_000 },
      );
      expect(
        messages
          .flatMap((message) => message.params?.deltas ?? [])
          .filter((delta) => delta.kind === "turn.boundary"),
      ).toEqual([expect.objectContaining({ status: "completed" })]);
    };

    try {
      await request("initialize", {
        protocolVersion: 2,
        client: { name: "idle-live-test", version: "1" },
        grammarVersions: [2, 3],
      });
      await request("thread/start", {
        threadId: "live",
        cwd: directory,
        instructionMode: "append",
        options,
      });

      const identity = z
        .string()
        .parse(
          messages.find((message) => message.method === "thread/identity")?.params
            ?.providerThreadId,
        );

      const turn = (text: string, clientRequestId: string) =>
        request("turn/start", {
          threadId: "live",
          providerThreadId: identity,
          clientRequestId,
          input: [{ type: "text", text, mentions: [] }],
          options,
        });

      await turn(
        "Remember the exact marker IDLE_CEDAR_7319. Reply only OK. Do not use any tools.",
        "creq_abcdefghij",
      );
      await finish();
      const firstPid = Number((await readFile(pids, "utf8")).trim());
      expect(Number.isSafeInteger(firstPid) && firstPid > 0).toBe(true);
      await vi.waitFor(() => expect(() => process.kill(firstPid, 0)).toThrow(), {
        timeout: 10_000,
      });
      console.log("Idle session process exited; restoring the saved conversation.");
      messages.splice(0);
      await turn(
        "What exact marker did I give you? Reply only with that marker. Do not use any tools.",
        "creq_bcdefghijk",
      );
      await finish();
      expect(
        messages.find((message) => message.method === "thread/identity")?.params?.providerThreadId,
      ).toBe(identity);
      expect(
        messages
          .flatMap((message) => message.params?.deltas ?? [])
          .flatMap((delta) => (delta.kind === "item.textDelta" ? [delta.text] : []))
          .join(""),
      ).toContain("IDLE_CEDAR_7319");
      const processes = (await readFile(pids, "utf8")).trim().split("\n");
      expect(processes).toHaveLength(2);
      expect(processes[0]).not.toBe(processes[1]);
      console.log("Restored conversation recalled its marker in a new process.");
    } finally {
      await bridge.onClose();
      await rm(directory, { recursive: true, force: true });
    }
  },
  240_000,
);
