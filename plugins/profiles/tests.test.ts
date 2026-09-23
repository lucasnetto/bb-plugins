import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";
import { z } from "zod";
import { profileInfoSchema } from "./contract.ts";
import type { ResumeBrowser } from "./navigation.ts";
import { resolveProfile } from "./profile.ts";
import { destinationUrl, profileSwitchUrl, resumeThread, savedThreadPath } from "./navigation.ts";

void test("profile selection rejects an unknown instance instead of falling back to Personal", () => {
  assert.equal(resolveProfile("/home/example/.bb"), "personal");
  assert.equal(resolveProfile("/home/example/.bb-work/"), "work");
  assert.throws(() => resolveProfile("/home/example/.bb-test"));
});

void test("remote clients never receive loopback destinations", () => {
  assert.equal(
    destinationUrl("https://work.example.com", "http://127.0.0.1:48886", "personal.example.com"),
    "https://work.example.com",
  );
  assert.equal(
    destinationUrl("https://work.example.com", "http://127.0.0.1:48886", "127.0.0.1"),
    "http://127.0.0.1:48886",
  );
});

for (const profile of ["personal", "work"] as const) {
  void test(`${profile} offers only its Cursor account and uses the normal spawn mechanism`, async () => {
    const root = mkdtempSync(join(tmpdir(), "bb-profiles-test-"));

    const { bb, harness } = createFakePluginHost({
      pluginId: "profiles",
      dataDir: join(root, profile === "work" ? ".bb-work" : ".bb"),
    });

    try {
      await plugin(bb);
      const info = profileInfoSchema.parse(await harness.behavior.callRpc("info", null));
      assert.equal(info.current, profile);
      const registrations = harness.inspection.registrations;
      assert.deepEqual(registrations.agentTools, []);
      const ids = registrations.providerRegistrations.map((p) => p.id);
      assert.deepEqual(
        ids,
        profile === "work" ? ["acp-cursor"] : ["acp-cursor", "acp-cursor-personal"],
      );
      const hook = registrations.hooks["message.dispatch"]!;

      for (const providerId of ["codex", "pi"]) {
        assert.equal(
          (await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId } })))
            .action,
          "proceed",
        );
      }

      const rejected = await hook(
        makeMessageDispatchHookContext({
          requestedExecution: { providerId: "unsupported-provider" },
        }),
      );

      assert.equal(rejected.action, "reject");

      if (rejected.action === "reject") assert.match(rejected.message, /Codex, Cursor, and Pi/);
      assert.equal(
        (
          await hook(
            makeMessageDispatchHookContext({ requestedExecution: { providerId: "acp-cursor" } }),
          )
        ).action,
        "proceed",
      );
      assert.equal(
        (
          await hook(
            makeMessageDispatchHookContext({ requestedExecution: { providerId: "cursor-sdk" } }),
          )
        ).action,
        "proceed",
      );
      assert.equal(
        (
          await hook(
            makeMessageDispatchHookContext({
              requestedExecution: { providerId: "acp-cursor-work" },
            }),
          )
        ).action,
        "reject",
      );

      if (profile === "work") {
        assert.equal(
          (
            await hook(
              makeMessageDispatchHookContext({
                requestedExecution: { providerId: "acp-cursor-personal" },
              }),
            )
          ).action,
          "reject",
        );
      }

      const cursor = registrations.providerRegistrations[0];

      const launch = z
        .object({
          command: z.string(),
          env: z.record(z.string(), z.string()),
          modelCli: z.object({ listArgs: z.array(z.string()), primaryModels: z.array(z.string()) }),
        })
        .parse(cursor.experimental_bridgeOptions?.acpLaunchSpec);

      assert.equal(
        profile === "personal"
          ? launch.command.endsWith("/.local/bin/cursor-agent-personal-acp")
          : launch.command === "bb-cursor-work-acp",
        true,
      );
      assert.deepEqual(launch.env, {});
      assert.deepEqual(
        launch.modelCli,
        { listArgs: ["--list-models"], primaryModels: [] },
        "Both accounts discover models and effort variants through the CLI",
      );
      assert.deepEqual(
        cursor.experimental_bridgeOptions?.excludedCursorModelIds,
        profile === "personal" ? [] : ["auto", "default"],
      );
    } finally {
      await harness.lifecycle.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

void test("profile switching requests restoration on the destination origin", () => {
  assert.equal(
    profileSwitchUrl("https://work.example.com", "http://127.0.0.1:48886", "127.0.0.1"),
    "http://127.0.0.1:48886/?bb-profile-resume=1",
  );
  assert.equal(
    profileSwitchUrl("https://work.example.com", "http://127.0.0.1:48886", "personal.example.com"),
    "https://work.example.com/?bb-profile-resume=1",
  );
});

void test("restoration accepts only saved local thread routes", () => {
  assert.equal(
    savedThreadPath("/projects/proj_123/threads/thr_456"),
    "/projects/proj_123/threads/thr_456",
  );

  for (const value of [
    null,
    "",
    "/",
    "/settings",
    "https://evil.example/projects/p/threads/t",
    "//evil.example",
    "/projects/p/threads/../settings",
    "/projects/p/threads/t?redirect=elsewhere",
  ]) {
    assert.equal(savedThreadPath(value), null);
  }
});

void test("restoration navigates inside BB once, consumes the marker and preserves history state", () => {
  const location = { href: "https://work.example.com/?bb-profile-resume=1&keep=yes#anchor" };
  const state = { key: "router-entry", idx: 2 };
  const opened: string[] = [];

  const browser: ResumeBrowser = {
    location,
    localStorage: { getItem: () => "/projects/proj_123/threads/thr_456" },
    history: {
      state,
      replaceState(nextState, _title, url) {
        assert.equal(nextState, state);
        assert.ok(url);
        location.href = String(url);
      },
    },
  };

  resumeThread(browser, (id) => opened.push(id));
  resumeThread(browser, (id) => opened.push(id));
  assert.deepEqual(opened, ["thr_456"]);
  assert.equal(location.href, "https://work.example.com/?keep=yes#anchor");
});

void test("direct visits never read storage or trigger restoration", () => {
  for (const href of [
    "https://work.example.com/",
    "https://work.example.com/?bb-profile-resume=0",
    "https://work.example.com/projects/p/threads/t?bb-profile-resume=1",
  ]) {
    const browser: ResumeBrowser = {
      location: { href },
      get localStorage(): never {
        throw new Error("Should not read storage");
      },
      get history(): never {
        throw new Error("Should not change history");
      },
    };

    resumeThread(browser, () => assert.fail("Should not navigate"));
  }
});

void test("missing, unsafe and unavailable storage leave New thread open and clear the marker", () => {
  for (const saved of [null, "https://evil.example/", "/settings", "blocked"]) {
    const location = { href: "https://work.example.com/?bb-profile-resume=1" };

    const browser: ResumeBrowser = {
      location,
      get localStorage() {
        if (saved === "blocked") throw new Error("Storage is disabled");

        return { getItem: () => saved };
      },
      history: {
        state: null,
        replaceState(_state, _title, url) {
          assert.ok(url);
          location.href = String(url);
        },
      },
    };

    resumeThread(browser, () => assert.fail("Should not navigate"));
    assert.equal(location.href, "https://work.example.com/");
  }
});

void test("account settings update live and reject unsafe addresses", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "profiles",
    dataDir: "/tmp/.bb",
  });

  await plugin(bb);

  try {
    assert.deepEqual(
      profileInfoSchema.parse(await harness.behavior.callRpc("info", null)).profiles,
      [],
    );
    await harness.behavior.setSettings({
      workUrl: "https://work.example.com",
      workEmail: "work@example.com",
    });
    const info = profileInfoSchema.parse(await harness.behavior.callRpc("info", null));
    assert.equal(info.profiles[0]?.email, "work@example.com");
    assert.equal(info.profiles[0]?.url, "https://work.example.com");
    await assert.rejects(() => harness.behavior.setSettings({ workUrl: "javascript:alert(1)" }));
    await assert.rejects(() =>
      harness.behavior.setSettings({ workLocalUrl: "https://remote.example.com" }),
    );
    await assert.rejects(() =>
      harness.behavior.setSettings({ workUrl: "https://user:password@example.com" }),
    );
    assert.equal(harness.inspection.registrations.providerRegistrations.length, 2);
  } finally {
    await harness.lifecycle.dispose();
  }
});
