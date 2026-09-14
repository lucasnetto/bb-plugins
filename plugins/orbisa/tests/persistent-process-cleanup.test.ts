import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { CLEAN_PROCESSES } from "../persistent-process-cleanup.ts";

void test("process cleanup selects detached workspace/thread jobs but preserves BB and other users", () => {
  const cases = String.raw`
from pathlib import Path
home = Path('/home/agent')
base = dict(pid=123, uid=os.getuid(), comm='node', args=['node','server.js'], cwd='/workspace/app', thread='')
assert eligible(base, ['/workspace/app'], [], home)
assert not eligible(dict(base,cwd='/workspace/application'), ['/workspace/app'], [], home)
assert eligible(dict(base,cwd='/tmp',thread='thr_job'), [], ['thr_job'], home)
assert not eligible(dict(base,cwd='/tmp',thread='thr_other'), [], ['thr_job'], home)
assert not eligible(dict(base,uid=os.getuid()+1), ['/workspace/app'], [], home)
assert not eligible(dict(base,pid=1), ['/workspace/app'], [], home)
assert not eligible(dict(base,comm='systemd'), ['/workspace/app'], [], home)
assert not eligible(dict(base,args=['node','/home/agent/.bb-machines/orbisa/npm/daemon.mjs']), ['/workspace/app'], [], home)
`;

  const result = spawnSync(
    "python3",
    ["-c", CLEAN_PROCESSES.replace("if __name__ == '__main__': main()", cases)],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
});
