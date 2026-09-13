// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, renderHook } from "@testing-library/react";
import { Schema } from "effect";
import { useLocalStorageState } from "../../src/ui/hooks/useLocalStorageState";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

test.each(["true", "false"])("loads a valid persisted shelf state: %s", (raw) => {
  window.localStorage.setItem("shelf", raw);
  const { result } = renderHook(() => useLocalStorageState("shelf", false, Schema.Boolean));
  expect(result.current[0]).toBe(raw === "true");
});

test.each(['"false"', "{}", "[]", "null", "broken-json"])(
  "rejects malformed shelf state: %s",
  (raw) => {
    window.localStorage.setItem("shelf", raw);
    const { result } = renderHook(() => useLocalStorageState("shelf", false, Schema.Boolean));
    expect(result.current[0]).toBe(false);
  },
);

test.each(['"p1"', "null"])("loads persisted project scope: %s", (raw) => {
  window.localStorage.setItem("scope", raw);

  const { result } = renderHook(() =>
    useLocalStorageState("scope", null, Schema.NullOr(Schema.String)),
  );

  expect(result.current[0]).toBe(raw === "null" ? null : "p1");
});
