import { expect, test } from "vite-plus/test";
import type { SDKModel } from "@cursor/sdk";
import {
  decodeModel,
  encodeModel,
  legacyModelCatalog,
  modelCatalog,
  resolveModel,
} from "../../src/server/models.js";

// Cursor advertises effort even with thinking disabled; "none" is not an effort.
const opus: SDKModel = {
  id: "opus",
  displayName: "Opus",
  parameters: [
    {
      id: "context",
      values: [
        { value: "300k", displayName: "300K" },
        { value: "1m", displayName: "1M" },
      ],
    },
  ],
  variants: ["300k", "1m"].flatMap((context) =>
    [false, true].flatMap((thinking) =>
      (thinking ? ["low", "medium", "high", "xhigh", "max"] : ["low", "medium", "high"]).flatMap(
        (effort) =>
          [false, true].map((fast) => ({
            displayName: "Opus",
            params: [
              { id: "context", value: context },
              { id: "thinking", value: String(thinking) },
              { id: "effort", value: effort },
              { id: "fast", value: String(fast) },
            ],
          })),
      ),
    ),
  ),
};

const params = (selection: ReturnType<typeof resolveModel>) =>
  Object.fromEntries(selection.params?.map((p) => [p.id, p.value]) ?? []);

test("thinking and speed are controls, while context sizes remain separate models", () => {
  const models = modelCatalog([opus]);
  expect(models.map((m) => m.displayName)).toEqual(["Opus (300K)", "Opus (1M)"]);
  expect(decodeModel(models[0].model)).toEqual({
    id: "opus",
    params: [{ id: "context", value: "300k" }],
  });
  expect(models[0].supportedReasoningEfforts.map((r) => r.reasoningEffort)).toEqual([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);

  const changed = {
    ...opus,
    variants: opus.variants?.filter(
      (v) => !v.params.some((p) => p.id === "fast" && p.value === "true"),
    ),
  };

  expect(modelCatalog([changed]).map((m) => m.id)).toEqual(models.map((m) => m.id));
});

test.each(["none", "low", "medium", "high", "xhigh", "max"] as const)(
  "resolves Opus %s without inventing parameters",
  (level) => {
    const model = modelCatalog([opus])[1];

    for (const tier of ["default", "fast"] as const) {
      const selected = resolveModel(model.model, [opus], level, tier);
      expect(opus.variants?.map((v) => v.params)).toContainEqual(selected.params);
      expect(params(selected)).toMatchObject({
        context: "1m",
        thinking: level === "none" ? "false" : "true",
        fast: String(tier === "fast"),
      });

      if (level !== "none") expect(params(selected).effort).toBe(level);
      else expect(params(selected).effort).not.toBe("none");
    }
  },
);

test("legacy preset IDs accept the separate controls and preserve settings when omitted", () => {
  const legacy = {
    id: "opus",
    params: [
      { id: "context", value: "300k" },
      { id: "thinking", value: "true" },
      { id: "effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  };

  const id = encodeModel(legacy);
  const catalog = modelCatalog([opus]);
  expect(catalog.some((row) => row.id === id)).toBe(false);
  expect(legacyModelCatalog([opus], catalog)).toContainEqual(
    expect.objectContaining({ id, displayName: "Opus (300K)", isDefault: false }),
  );
  expect(resolveModel(id, [opus])).toEqual(legacy);
  expect(params(resolveModel(id, [opus], "none", "default"))).toMatchObject({
    context: "300k",
    thinking: "false",
    fast: "false",
  });
});

test("boolean-only thinking is None or High and unsupported speed keeps the available variant", () => {
  const model: SDKModel = {
    id: "haiku",
    displayName: "Haiku",
    variants: [false, true].map((thinking) => ({
      displayName: "Haiku",
      isDefault: thinking,
      params: [{ id: "thinking", value: String(thinking) }],
    })),
  };

  const [row] = modelCatalog([model]);
  expect(row.displayName).toBe("Haiku");
  expect(row.defaultReasoningEffort).toBe("high");
  expect(row.supportedReasoningEfforts.map((r) => r.reasoningEffort)).toEqual(["none", "high"]);
  expect(params(resolveModel(row.model, [model], "none", "fast"))).toEqual({ thinking: "false" });
  expect(params(resolveModel(row.model, [model], "high", "default"))).toEqual({ thinking: "true" });
  expect(() => resolveModel(row.model, [model], "low")).toThrow("does not support low");
});

test("numeric reasoning and fast mode resolve independently", () => {
  const model: SDKModel = {
    id: "gpt",
    displayName: "GPT",
    variants: ["none", "low", "medium", "high"].flatMap((reasoning) =>
      [false, true].map((fast) => ({
        displayName: "GPT",
        params: [
          { id: "reasoning", value: reasoning },
          { id: "fast", value: String(fast) },
        ],
      })),
    ),
  };

  const [row] = modelCatalog([model]);
  expect(modelCatalog([model])).toHaveLength(1);
  expect(params(resolveModel(row.model, [model], "high", "fast"))).toEqual({
    reasoning: "high",
    fast: "true",
  });
  expect(params(resolveModel(row.model, [model], "none", "default"))).toEqual({
    reasoning: "none",
    fast: "false",
  });
  expect(() => resolveModel(row.model, [model], "max")).toThrow("does not support max");
});

test("models with only speed ignore an inherited reasoning setting", () => {
  const model: SDKModel = {
    id: "composer",
    displayName: "Composer",
    variants: [true, false].map((fast) => ({
      displayName: "Composer",
      isDefault: fast,
      params: [{ id: "fast", value: String(fast) }],
    })),
  };

  const [row] = modelCatalog([model]);
  expect(row.displayName).toBe("Composer");
  expect(params(resolveModel(row.model, [model], "medium", "default"))).toEqual({ fast: "false" });
  expect(params(resolveModel(row.model, [model], "none", "fast"))).toEqual({ fast: "true" });
});
