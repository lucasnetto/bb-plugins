import assert from "node:assert/strict";
import { test } from "node:test";
import { cursorArgs } from "./cursor.ts";

void test("Cursor launch always requests classic IDE and preserves path arguments", () => {
  for (const path of ["/work/180seg", "/work/180seg.code-workspace", "/work/space and 'quotes'"]) {
    assert.deepEqual(cursorArgs({ path }), ["--classic", path]);
  }
  assert.deepEqual(cursorArgs({ path: "/work/a.ts", lineNumber: 12, columnNumber: 3 }), [
    "--classic",
    "--goto",
    "/work/a.ts:12:3",
  ]);
  assert.throws(() => cursorArgs({ path: "--glass" }), /absolute path/);
});
