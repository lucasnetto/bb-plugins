import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Deferred, Effect } from "effect";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { runHost, type Command } from "../../src/server/host-effects";
import { linkedSummary } from "../../src/server/links-host";
import { linkedContents as contentsEffect } from "../../src/server/links-host";
import plugin from "../../server";

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
      runHost(
        linkedSummary("/repo", "https://github.com/org/api/pull/42"),
        undefined,
        async (_cwd, program) => {
          calls++;

          return program === "git" ? "git@github.com:org/repo.git" : reply;
        },
      ),
    );
    assert.equal(calls, 1);
  }

  let calls = 0;
  await assert.rejects(
    runHost(linkedSummary("/repo", "https://github.com/org/api/pull/42"), undefined, async () => {
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

  const detail = {
    pr: {
      url: "https://github.com/org/api/pull/42",
      repository: "org/api",
      number: 42,
      title: "PR",
      state: "OPEN",
      isDraft: false,
    },
    body: "",
    headRefName: "fix",
    baseRefName: "main",
    repositoryRoot: null,
    files: [],
  };

  const input = { url: detail.pr.url };

  const initial = createFakePluginHost({
    pluginId: "pr-review",
    sdk: { system: { config: async () => ({ primaryHostId: "host" }) } },
    experimental_callHostRpc: async ({ signal }) => {
      if (!wait) return detail;

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
    await plugin(bb);
    const rejected = assert.rejects(harness.behavior.callRpc("reviewDraftDetail", input));
    await ready.wait();
    ({ harness } = await harness.lifecycle.reload(plugin));
    await rejected;
    assert.equal(aborted, true);
    wait = false;
    assert.deepEqual(await harness.behavior.callRpc("reviewDraftDetail", input), detail);
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
