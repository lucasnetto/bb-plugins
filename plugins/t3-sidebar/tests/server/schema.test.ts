import { test, expect } from "vite-plus/test";
import { Schema } from "effect";
import {
  preferencesSchema,
  projectSettingsContract,
} from "../../src/shared/project-settings-contract";
import { snoozeContract } from "../../src/shared/snooze-contract";

test("settings retain defaults and trim updates while enforcing only the strict envelope", async () => {
  expect(Schema.decodeUnknownSync(preferencesSchema)({})).toEqual({
    model: null,
    workspace: "default",
    autoPull: false,
  });
  expect(
    Schema.decodeUnknownSync(preferencesSchema)({ model: undefined, autoPull: undefined }),
  ).toEqual({ model: null, workspace: "default", autoPull: false });
  const validate = projectSettingsContract.project_settings_update.input["~standard"].validate;
  const model = { providerId: "codex", model: "gpt-5", reasoningLevel: "high" };
  expect(
    await validate({
      projectId: "one",
      name: "  Renamed  ",
      model: { ...model, futureField: true },
    }),
  ).toEqual({ value: { projectId: "one", name: "Renamed", model } });
  expect((await validate({ projectId: "one", unexpected: true })).issues).toBeDefined();
  expect((await validate({ projectId: "one", name: "   " })).issues).toBeDefined();
  expect((await validate({ projectId: "one", autoPull: null })).issues).toBeDefined();
});

test("snooze timestamps preserve integer and Date limits through Standard Schema", async () => {
  const validate = snoozeContract.snoozed_set.input["~standard"].validate;

  for (const until of [null, 0, 8_640_000_000_000_000]) {
    expect(await validate({ threadId: "one", until })).toEqual({
      value: { threadId: "one", until },
    });
  }

  for (const until of [-1, 1.5, NaN, Infinity, 8_640_000_000_000_001]) {
    expect((await validate({ threadId: "one", until })).issues).toBeDefined();
  }
});
