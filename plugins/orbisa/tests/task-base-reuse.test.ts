import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { preparedBase } from "../task-base.ts";
import type { CachedBase } from "../task-base-retention.ts";
import type { CommandOptions } from "../task-process.ts";

void test("cold build, receipt reuse without wake, marker recovery, and replacement identity", async () => {
  const home = await mkdtemp(join(tmpdir(), "base-reuse-"));
  const bytes = Buffer.from("bb-package");
  let artifact = createHash("sha256").update(bytes).digest("hex");
  let machines: CachedBase[] = [];
  let ready = "";
  let sequence = 0;
  const calls: string[][] = [];
  const receipts = new Map<string, string>();

  const runtime = {
    home,
    fetch: async (_url: Parameters<typeof fetch>[0], options?: RequestInit) =>
      new Response(options?.method === "HEAD" ? null : bytes, {
        headers: { "x-bb-artifact-sha256": artifact },
      }),
    checked: async (argv: string[], options?: CommandOptions) => {
      calls.push(argv);

      if (argv[0] === "codex") return "codex-cli 1.2.3";

      if (argv[1] === "list") return JSON.stringify(machines);

      if (argv[1] === "clone")
        machines.push({
          name: argv[3],
          id: `vm-${++sequence}`,
          state: "stopped",
          config: { isolated: true, isolate_network: true, forward_ssh_agent: false, mounts: [] },
        });

      if (argv[1] === "delete") machines = machines.filter((vm) => vm.name !== argv[3]);

      if (argv.at(-1)?.includes("cat > ~/.cache/orbisa/base-ready"))
        ready = String(options?.stdin);

      return "";
    },
    command: async (argv: string[]) => {
      calls.push(argv);

      return { exitCode: 0, stdout: ready };
    },
  };

  const options = {
    owner: "testowner",
    user: "user",
    source: { name: "cursor-base", id: "source" },
    serverUrl: "http://localhost",
    signal: new AbortController().signal,
    report() {},
    receipts: {
      get: async (name: string) => receipts.get(name) ?? null,
      set: async (name: string, id: string) => {
        receipts.set(name, id);
      },
      lastUsed: async () => null,
      touch: async () => {},
    },
  };

  try {
    const first = await preparedBase(options, runtime);
    assert.equal(calls.filter((argv) => argv[1] === "clone").length, 1);
    assert.match(ready, /^[a-f0-9]{16}$/);
    calls.length = 0;
    assert.equal(await preparedBase(options, runtime), first);
    assert.ok(
      !calls.some((argv) => ["start", "run", "clone"].includes(argv[1]!)),
      "durable receipt reuse must not wake the base",
    );
    machines[0].id = "replacement";
    ready = "stale-marker";
    calls.length = 0;
    assert.equal(await preparedBase(options, runtime), first);
    assert.ok(
      calls.some((argv) => argv[1] === "delete"),
      "a replacement with a mismatched marker must be rebuilt",
    );
    assert.ok(calls.some((argv) => argv[1] === "clone"));
    machines[0].id = "replacement-valid-marker";
    calls.length = 0;
    assert.equal(await preparedBase(options, runtime), first);
    assert.ok(calls.some((argv) => argv[1] === "start"));
    assert.ok(
      !calls.some((argv) => argv[1] === "clone"),
      "correct marker recovers a receipt without rebuilding",
    );
    machines[0].config.mounts = ["/mac"];
    await assert.rejects(preparedBase(options, runtime), /isolated/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
