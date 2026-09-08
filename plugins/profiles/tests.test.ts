import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";
import type { ProfileInfo } from "./contract.ts";
import { resolveProfile } from "./profile.ts";
import { destinationUrl, profileSwitchUrl, savedThreadPath } from "./navigation.ts";

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
      assert.equal((await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId: "acp-cursor" } }))).action, "proceed");
      assert.equal((await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId: "acp-cursor-work" } }))).action, "reject");
      if (profile === "work") {
        assert.equal((await hook(makeMessageDispatchHookContext({ requestedExecution: { providerId: "acp-cursor-personal" } }))).action, "reject");
      }
      const cursor = registrations.providerRegistrations[0];
      const launch = cursor.experimental_bridgeOptions?.acpLaunchSpec as { command: string; env: Record<string, string> };
      assert.equal(profile === "personal" ? launch.command.endsWith("cursor-agent-personal-acp") : launch.command === "bb-cursor-work-acp", true);
      assert.deepEqual(launch.env, {});
      assert.equal("modelCli" in launch, profile === "personal", "Work discovers models from authenticated ACP, avoiding the CLI default alias");
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
