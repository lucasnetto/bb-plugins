import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { defineSettings } from "../settings.ts";
import { prepareProfile, profilePaths } from "../profile.ts";

void test("credential conventions isolate profiles and reject unknown instances", async () => {
  assert.match(profilePaths("/profiles/.bb").codexHome, /\.codex$/);
  assert.match(profilePaths("/profiles/.bb-work").codexHome, /\.codex_work$/);
  await assert.rejects(
    () =>
      prepareProfile(
        "/unknown",
        { awsRegion: "" },
        async () => {
          throw new Error("must not execute");
        },
        new AbortController().signal,
        () => {},
      ),
    /configured Personal or Work/,
  );
});

void test("region remains a validated deployment preference", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "orbisa" });
  const settings = defineSettings(bb);

  try {
    await assert.rejects(() => harness.behavior.setSettings({ awsRegion: "invalid region\n" }));
    await harness.behavior.setSettings({ awsRegion: "eu-west-1" });
    assert.deepEqual(await settings.get(), { awsRegion: "eu-west-1" });
  } finally {
    await harness.lifecycle.dispose();
  }
});
