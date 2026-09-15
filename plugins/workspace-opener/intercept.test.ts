import assert from "node:assert/strict";
import { test } from "node:test";
import { mountWorkspaceOpener } from "./intercept.ts";

function fixture(options: { fail?: boolean; workspace?: string | null } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const original: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    if (url.endsWith("/open-cursor") && options.fail) throw new Error("launch failed");
    if (url.endsWith("/status")) return Response.json({ hostId: "local-host" });
    if (url.endsWith("/resolve")) {
      if (options.fail) throw new Error("offline");
      return Response.json({
        path: options.workspace === undefined ? "/work/main.code-workspace" : options.workspace,
      });
    }
    return Response.json({});
  };
  const scope = {
    fetch: original,
    location: new URL("https://bb.example/") as unknown as Location,
  };
  const controller = new AbortController();
  const dispose = mountWorkspaceOpener({ signal: controller.signal }, scope);
  const open = (changes: object = {}) =>
    scope.fetch("http://127.0.0.1:48887/open-in-target", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "/work",
        targetId: "vscode",
        context: { kind: "local" },
        lineNumber: null,
        ...changes,
      }),
    });
  return { calls, original, scope, controller, dispose, open };
}

void test("rewrites VS Code folder open on its actual local host and restores fetch", async () => {
  const f = fixture();
  await f.open();
  assert.equal(JSON.parse(f.calls[1].init!.body as string).hostId, "local-host");
  assert.equal(JSON.parse(f.calls[2].init!.body as string).path, "/work/main.code-workspace");
  assert.deepEqual(f.calls[2].init!.headers, { "content-type": "application/json" });
  f.controller.abort();
  assert.equal(f.scope.fetch, f.original);
  f.dispose();
});

void test("SSH opens resolve on the remote host, preserving context", async () => {
  const f = fixture();
  const context = { kind: "remote-ssh", hostId: "remote-host", serverOrigin: "https://bb.example" };
  await f.open({ context });
  assert.equal(f.calls.length, 2);
  assert.equal(JSON.parse(f.calls[0].init!.body as string).hostId, "remote-host");
  assert.deepEqual(JSON.parse(f.calls[1].init!.body as string).context, context);
  f.dispose();
});

void test("local Cursor folders and line targets use the IDE launcher only", async () => {
  for (const target of [{}, { path: "/work/a.ts", lineNumber: 12, columnNumber: 3 }]) {
    const f = fixture();
    await f.open({ targetId: "cursor", ...target });
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls[1].url.endsWith("/open-cursor"));
    const body = JSON.parse(f.calls[1].init!.body as string);
    assert.equal(body.hostId, "local-host");
    assert.equal(body.path, target.path ?? "/work");
    assert.equal(body.lineNumber, target.lineNumber ?? null);
    f.dispose();
  }
});

void test("Cursor launch errors never retry through Glass", async () => {
  const f = fixture({ fail: true });
  await assert.rejects(f.open({ targetId: "cursor" }), /launch failed/);
  assert.equal(f.calls.filter((c) => c.url.endsWith("/open-in-target")).length, 0);
  f.dispose();
});

void test("missing workspaces and lookup failures fall back exactly once", async () => {
  for (const options of [{ workspace: null }, { fail: true }]) {
    const f = fixture(options);
    await f.open();
    assert.equal(JSON.parse(f.calls.at(-1)!.init!.body as string).path, "/work");
    assert.equal(f.calls.filter((c) => c.url.endsWith("/open-in-target")).length, 1);
    f.dispose();
  }
});

void test("file line targets, Finder, terminals and other servers pass through", async () => {
  for (const changes of [
    { lineNumber: 12 },
    { targetId: "finder" },
    { targetId: "terminal" },
    { context: { kind: "remote-ssh", hostId: "other", serverOrigin: "https://other.example" } },
  ]) {
    const f = fixture();
    await f.open(changes);
    assert.equal(f.calls.length, 1);
    f.dispose();
  }
});

void test("unmount during a lookup preserves the folder and later wrappers", async () => {
  const f = fixture();
  const pending = f.open();
  const later: typeof fetch = (...args) => f.original(...args);
  f.scope.fetch = later;
  f.controller.abort();
  await pending;
  assert.equal(f.scope.fetch, later);
  assert.equal(JSON.parse(f.calls.at(-1)!.init!.body as string).path, "/work");
});
