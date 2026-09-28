import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRefresh } from "./refresh-runner.ts";

void test("private coordinator protocol dispatches bounded requests and preserves failure results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profiles-runner-"));

  try {
    const script = join(dir, "test.py");
    await writeFile(
      script,
      `import json,sys\nprint(json.dumps({'request':{'profile':'work','action':'list','argument':''}}),flush=True)\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({'result':{'errors':[] if 'value' in r else [r['error']]}}),flush=True)\nsys.exit(0 if 'value' in r else 1)\n`,
    );
    const calls: unknown[] = [];

    const ok = await runRefresh(script, [], {}, { work: "mac" }, async (request) => {
      calls.push(request);

      return '{"plugins":[]}';
    });

    assert.equal(ok.exitCode, 0);
    assert.deepEqual(calls, [{ profile: "work", action: "list", argument: "" }]);

    const bad = await runRefresh(script, [], {}, { work: "mac" }, async () => {
      throw new Error("private credential text");
    });

    assert.equal(bad.exitCode, 1);
    assert.doesNotMatch(bad.stdout + bad.stderr, /private credential/);
    assert.match(bad.stdout, /work/);
    await writeFile(
      script,
      `print('{"request":{"profile":"work","action":"exec","argument":"anything"}}',flush=True)\n`,
    );

    const invalid = await runRefresh(script, [], {}, {}, async () => {
      throw new Error("must not dispatch");
    });

    assert.equal(invalid.exitCode, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
