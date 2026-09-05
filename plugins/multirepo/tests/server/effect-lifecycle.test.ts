import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Deferred, Effect } from "effect";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { runHost, type Command } from "../../src/server/host-effects";
import { prs } from "../../src/server/git";
import { linkedContents as contentsEffect } from "../../src/server/links-host";
import plugin from "../../src/server/server";

const readySignal = () => {
  const deferred = Deferred.makeUnsafe<void>();
  return {
    wait: () => Effect.runPromise(Deferred.await(deferred)),
    signal: () => Effect.runSync(Deferred.succeed(deferred, undefined)),
  };
};
test("GitHub command and decoding errors remain failures, with no retries", async () => {
  for (const reply of ["invalid JSON", "{}", "[[{}]]"]) {
    let calls = 0;
    await assert.rejects(
      runHost(prs("/repo"), undefined, async (_cwd, program) => {
        calls++;
        return program === "git" ? "git@github.com:org/repo.git" : reply;
      }),
    );
    assert.equal(calls, 2);
  }
  let calls = 0;
  await assert.rejects(
    runHost(prs("/repo"), undefined, async () => {
      calls++;
      throw Object.assign(new Error("git unavailable"), { code: "ENOENT" });
    }),
    /git unavailable/,
  );
  assert.equal(calls, 1);
});

test("failed revision read aborts its sibling command", async () => {
  const started = readySignal();
  let aborted = false;
  await assert.rejects(
    linkedContents(
      "/repo",
      {
        url: "https://github.com/org/repo/pull/1",
        base: "a".repeat(40),
        head: "b".repeat(40),
        oldPath: "old",
        path: "new",
        changeType: "rename-changed",
      },
      undefined,
      async (_cwd, _program, args, signal) => {
        const route = args.at(-1) ?? "";
        if (route.includes("/compare/"))
          return JSON.stringify({ merge_base_commit: { sha: "c".repeat(40) } });
        if (route.includes("/old?")) {
          await started.wait();
          throw new Error("read failed");
        }
        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
          started.signal();
        });
      },
    ),
    /read failed/,
  );
  assert.equal(aborted, true);
});

test("plugin reload aborts an in-flight host call and the replacement can serve requests", async () => {
  const ready = readySignal();
  let aborted = false;
  let wait = true;
  const initial = createFakePluginHost({
    pluginId: "multirepo",
    settings: { project: "workspace" },
    sdk: {
      projects: {
        get: async () => ({
          id: "workspace",
          name: "Workspace",
          sources: [{ type: "local_path", path: "/workspace", hostId: "host", isDefault: true }],
        }),
      },
    },
    experimental_callHostRpc: async ({ signal }) => {
      if (!wait) return [];
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("cancelled"));
          },
          { once: true },
        );
        ready.signal();
      });
    },
  });
  const bb = initial.bb;
  let harness = initial.harness;
  try {
    plugin(bb);
    const rejected = assert.rejects(harness.behavior.callRpc("discover", null));
    await ready.wait();
    ({ harness } = await harness.lifecycle.reload(plugin));
    await rejected;
    assert.equal(aborted, true);
    wait = false;
    assert.deepEqual(await harness.behavior.callRpc("discover", null), []);
  } finally {
    await harness.lifecycle.dispose();
  }
});

function linkedContents(
  root: string,
  input: Parameters<typeof contentsEffect>[1],
  signal?: AbortSignal,
  run?: Command,
) {
  return runHost(contentsEffect(root, input), signal, run);
}
