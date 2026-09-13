// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { readCache, STORAGE_KEY } from "../../src/ui/lib/hidden-model-cache";

test("cache validation retains valid rows among malformed entries", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      { providerId: "work", name: "model" },
      null,
      "model",
      { providerId: 12, name: "model" },
      { providerId: "work" },
      { providerId: "personal", name: "other" },
    ]),
  );
  expect(readCache()).toEqual([
    { providerId: "work", name: "model" },
    { providerId: "personal", name: "other" },
  ]);
});

test("missing, invalid JSON and non-array caches read as empty", () => {
  localStorage.removeItem(STORAGE_KEY);
  expect(readCache()).toEqual([]);

  for (const stored of ["{", "null", '{"providerId":"work","name":"model"}']) {
    localStorage.setItem(STORAGE_KEY, stored);
    expect(readCache()).toEqual([]);
  }
});
