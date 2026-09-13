import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";
import type { ProfileInfo } from "./contract.ts";
import { resolveProfile } from "./profile.ts";
import { destinationUrl, profileSwitchUrl, resumeThread, savedThreadPath } from "./navigation.ts";

test("profile selection rejects an unknown instance instead of falling back to Personal", () => {
  assert.equal(resolveProfile("/home/example/.bb"), "personal");
  assert.equal(resolveProfile("/home/example/.bb-work/"), "work");
  assert.throws(() => resolveProfile("/home/example/.bb-test"));
});

test("remote clients never receive loopback destinations", () => {
  assert.equal(destinationUrl("https://work.example.com", "http://127.0.0.1:48886", "personal.example.com"), "https://work.example.com");
  assert.equal(destinationUrl("https://work.example.com", "http://127.0.0.1:48886", "127.0.0.1"), "http://127.0.0.1:48886");
});

for (const profile of ["personal", "work"] as const) {
  test(`${profile} offers only its Cursor account and uses the normal spawn mechanism`, async () => {
    const root = mkdtempSync(join(tmpdir(), "bb-profiles-test-"));
    const { bb, harness } = createFakePluginHost({ pluginId: "profiles", dataDir: join(root, profile === "work" ? ".bb-work" : ".bb") });
    try {
      plugin(bb);
      const info = await harness.behavior.callRpc("info", null) as ProfileInfo;
      assert.equal(info.current, profile);
      const registrations = harness.inspection.registrations;
      assert.deepEqual(registrations.agentTools, []);
      const ids = registrations.providerRegistrations.map(p => p.id);
      assert.deepEqual(ids, profile === "work" ? ["acp-cursor"] : ["acp-cursor", "acp-cursor-personal"]);
      const hook = registrations.hooks["message.dispatch"]!;
      for (const providerId of ["codex", "pi"]) {
        assert.equal((await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId } }))).action, "proceed");
      }
      const rejected = await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId: "unsupported-provider" } }));
      assert.equal(rejected.action, "reject");
      if (rejected.action === "reject") assert.match(rejected.message, /Codex, Cursor, and Pi/);
      assert.equal((await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId: "acp-cursor" } }))).action, "proceed");
      assert.equal((await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId: "cursor-sdk" } }))).action, "proceed");
      assert.equal((await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId: "acp-cursor-work" } }))).action, "reject");
      if (profile === "work") {
        assert.equal((await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId: "acp-cursor-personal" } }))).action, "reject");
      }
      const cursor = registrations.providerRegistrations[0];
      const launch = cursor.experimental_bridgeOptions?.acpLaunchSpec as { command: string; env: Record<string, string>; modelCli: unknown };
      assert.equal(profile === "personal" ? launch.command.endsWith("cursor-agent-personal-acp") : launch.command === "bb-cursor-work-acp", true);
      assert.deepEqual(launch.env, {});
      assert.deepEqual(launch.modelCli, { listArgs: ["--list-models"], primaryModels: [] }, "Both accounts discover models and effort variants through the CLI");
      assert.deepEqual(cursor.experimental_bridgeOptions?.excludedCursorModelIds, profile === "personal" ? [] : ["auto", "default"]);
    } finally {
      await harness.lifecycle.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
}


test("profile switching requests restoration on the destination origin", () => {
  assert.equal(profileSwitchUrl("https://work.example.com", "http://127.0.0.1:48886", "127.0.0.1"), "http://127.0.0.1:48886/?bb-profile-resume=1");
  assert.equal(profileSwitchUrl("https://work.example.com", "http://127.0.0.1:48886", "personal.example.com"), "https://work.example.com/?bb-profile-resume=1");
});

test("restoration accepts only saved local thread routes", () => {
  assert.equal(savedThreadPath("/projects/proj_123/threads/thr_456"), "/projects/proj_123/threads/thr_456");
  for (const value of [null, "", "/", "/settings", "https://evil.example/projects/p/threads/t", "//evil.example", "/projects/p/threads/../settings", "/projects/p/threads/t?redirect=elsewhere"]) {
    assert.equal(savedThreadPath(value), null);
  }
});


test("restoration navigates inside BB once, consumes the marker and preserves history state", () => {
  const location = { href: "https://work.example.com/?bb-profile-resume=1&keep=yes#anchor" };
  const state = { key: "router-entry", idx: 2 };
  const opened: string[] = [];
  const browser = {
    location,
    localStorage: { getItem: () => "/projects/proj_123/threads/thr_456" },
    history: {
      state,
      replaceState(nextState: unknown, _title: string, url: string) {
        assert.equal(nextState, state);
        location.href = url;
      },
    },
  } as unknown as Parameters<typeof resumeThread>[0];
  resumeThread(browser, id => opened.push(id));
  resumeThread(browser, id => opened.push(id));
  assert.deepEqual(opened, ["thr_456"]);
  assert.equal(location.href, "https://work.example.com/?keep=yes#anchor");
});

test("direct visits never read storage or trigger restoration", () => {
  for (const href of ["https://work.example.com/", "https://work.example.com/?bb-profile-resume=0", "https://work.example.com/projects/p/threads/t?bb-profile-resume=1"]) {
    const browser = {
      location: { href },
      get localStorage() { throw new Error("Should not read storage"); },
      get history() { throw new Error("Should not change history"); },
    } as unknown as Parameters<typeof resumeThread>[0];
    resumeThread(browser, () => assert.fail("Should not navigate"));
  }
});

test("missing, unsafe and unavailable storage leave New thread open and clear the marker", () => {
  for (const saved of [null, "https://evil.example/", "/settings", "blocked"]) {
    const location = { href: "https://work.example.com/?bb-profile-resume=1" };
    const browser = {
      location,
      get localStorage() {
        if (saved === "blocked") throw new Error("Storage is disabled");
        return { getItem: () => saved };
      },
      history: {
        state: null,
        replaceState(_state: unknown, _title: string, url: string) { location.href = url; },
      },
    } as unknown as Parameters<typeof resumeThread>[0];
    resumeThread(browser, () => assert.fail("Should not navigate"));
    assert.equal(location.href, "https://work.example.com/");
  }
});
