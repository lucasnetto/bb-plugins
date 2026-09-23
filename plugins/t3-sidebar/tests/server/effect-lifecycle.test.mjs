import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { Effect, Layer } from "effect";
import plugin from "../../src/server/server";
import hostEntry from "../../src/server/host";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { PullGit, PullError, pullCleanDefaultBranch } from "../../src/server/lib/project-auto-pull";

test("auto-pull skips disabled/offline sources, isolates failures, and cancels on disposal", async () => {
  const ready = Promise.withResolvers();
  let calls = 0;
  let aborted = false;

  const { bb, harness } = createFakePluginHost({
    pluginId: "t3-sidebar",
    sdk: {
      hosts: { list: async () => [{ id: "online", status: "connected" }] },
      projects: {
        list: async () => [
          { id: "disabled", sources: [{ hostId: "online", path: "/disabled" }] },
          {
            id: "enabled",
            name: "Enabled",
            sources: [
              { hostId: "offline", path: "/offline" },
              { hostId: "online", path: "/discovery-failure" },
              { hostId: "online", path: "/empty" },
              { hostId: "online", path: "/group" },
            ],
          },
        ],
      },
    },
    experimental_callHostRpc: async ({ method, input, signal }) => {
      if (method === "discover") {
        if (input.path === "/discovery-failure") throw new Error("discovery failed");

        if (input.path === "/empty") return { paths: [], errors: [] };
        assert.equal(input.path, "/group");

        return {
          paths: ["/group/failure", "/group/waiting", "/group/never"],
          errors: [{ path: "/group/unreadable", message: "permission denied" }],
        };
      }

      assert.equal(method, "pull");
      calls++;

      if (input.path === "/group/failure") throw new Error("fetch failed");
      assert.equal(input.path, "/group/waiting");

      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("cancelled"));
          },
          { once: true },
        );
        ready.resolve();
      });
    },
  });

  try {
    await plugin(bb);
    await bb.storage.kv.set("project-settings:enabled", { autoPull: true });
    const rejected = assert.rejects(harness.behavior.runSchedule("project-auto-pull"));
    await ready.promise;
    await harness.behavior.runSchedule("project-auto-pull");
    assert.equal(calls, 2, "overlapping tick must not issue another pull");
    await harness.lifecycle.dispose();
    await rejected;
    assert.equal(aborted, true);
    assert.equal(harness.logEntries.filter((entry) => entry.level === "warn").length, 3);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("auto-pull propagates interruption and execution failures without fetching", async () => {
  const host = experimental_createHostEntryHarness(hostEntry);

  try {
    await assert.rejects(
      host.experimental_call("discover", { path: "/unused" }, { signal: AbortSignal.abort() }),
    );
    await assert.rejects(
      host.experimental_call("pull", { path: "/unused" }, { signal: AbortSignal.abort() }),
    );
  } finally {
    await host.experimental_dispose();
  }

  const commands = [];

  const layer = Layer.succeed(PullGit, {
    run: (_path, args) => {
      commands.push(args);

      return Effect.fail(
        new PullError({ message: "git executable missing", cause: { code: "ENOENT" } }),
      );
    },
  });

  await assert.rejects(
    Effect.runPromise(pullCleanDefaultBranch("/repo").pipe(Effect.provide(layer))),
    /git executable missing/,
  );
  assert.equal(commands.length, 1);
});

test("auto-pull rechecks branch after fetch and does not merge a changed checkout", async () => {
  let fetched = false;
  const commands = [];

  const layer = Layer.succeed(PullGit, {
    run: (_path, args) =>
      Effect.sync(() => {
        commands.push(args[0]);

        if (args[0] === "fetch") {
          fetched = true;

          return "";
        }

        if (args[0] === "symbolic-ref")
          return args.at(-1) === "HEAD"
            ? fetched
              ? "refs/heads/feature"
              : "refs/heads/main"
            : "refs/remotes/origin/HEAD".replace("HEAD", "main");

        if (args[0] === "rev-parse") return "origin/main";

        if (args[0] === "config") return "origin";

        if (args[0] === "rev-list") return "0";

        return "";
      }),
  });

  assert.deepEqual(
    await Effect.runPromise(pullCleanDefaultBranch("/repo").pipe(Effect.provide(layer))),
    { pulled: false },
  );
  assert.ok(fetched);
  assert.ok(!commands.includes("merge"));
});
