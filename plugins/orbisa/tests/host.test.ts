import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../host.ts";

void test("host transport preserves argv, private stdin and exit status; rejects wrong platform", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbisa-host-test-"));
  const previous = process.env.PATH;
  await writeFile(
    join(dir, "orbisa"),
    `#!/usr/bin/env node
let input=''; process.stdin.setEncoding('utf8').on('data',s=>input+=s).on('end',()=>{
 process.stdout.write(JSON.stringify({args:process.argv.slice(2),input}));
 process.stderr.write('guest stderr'); process.exitCode=7;
});
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${dir}:${previous}`;
  const harness = experimental_createHostEntryHarness(entry);
  try {
    const backend = process.platform === "darwin" ? "orbstack" : "incus";
    const request = {
      action: "exec" as const,
      backend: backend as "incus" | "orbstack",
      owner: "owner",
      key: "key",
      command: ["printf", "%s", "literal $(false); ' value"],
      stdin: "private input",
    };
    const result = await harness.experimental_call("run", request);
    assert.equal(result.exitCode, 7);
    assert.equal(result.stderr, "guest stderr");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.input, "private input");
    assert.deepEqual(payload.args.slice(-5), ["--raw", "--", ...request.command]);
    assert.ok(!payload.args.includes(request.stdin));
    await assert.rejects(
      harness.experimental_call("run", {
        ...request,
        backend: backend === "incus" ? "orbstack" : "incus",
      }),
      /platform/,
    );
  } finally {
    await harness.experimental_dispose();
    process.env.PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
