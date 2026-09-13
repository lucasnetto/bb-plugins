// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, configure } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { HIDDEN_CHANGED, type CatalogProvider, type HiddenModel } from "../../src/shared/contract";
import { CHANGED_EVENT, readCache } from "../../src/ui/lib/hidden-model-cache";

installTestPluginRuntime();

const { useHiddenModels } = await import("../../src/ui/hooks/useHiddenModels");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;

  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

const models = (name: string): HiddenModel[] => [
  { providerId: "work", model: name, displayName: name },
];

const providers: CatalogProvider[] = [
  {
    id: "work",
    displayName: "Work",
    available: true,
    brandPrefix: null,
    loadError: null,
    models: [],
  },
];

function mount(strict = false) {
  configure({ reactStrictMode: strict });
  const reads: ReturnType<typeof deferred<{ hidden: HiddenModel[] }>>[] = [];
  const writes: ReturnType<typeof deferred<{ hidden: HiddenModel[] }>>[] = [];
  const catalogs: ReturnType<typeof deferred<{ providers: CatalogProvider[] }>>[] = [];
  let state!: ReturnType<typeof useHiddenModels>;

  function Probe() {
    state = useHiddenModels();

    return null;
  }

  const slot = renderSlot(
    { component: Probe },
    {},
    {
      rpc: {
        hidden_get: () => {
          const response = deferred<{ hidden: HiddenModel[] }>();
          reads.push(response);

          return response.promise;
        },
        hidden_set: () => {
          const response = deferred<{ hidden: HiddenModel[] }>();
          writes.push(response);

          return response.promise;
        },
        catalog: () => {
          const response = deferred<{ providers: CatalogProvider[] }>();
          catalogs.push(response);

          return response.promise;
        },
      },
    },
  );

  return {
    slot,
    reads,
    writes,
    catalogs,
    get state() {
      return state;
    },
  };
}

function expectHidden(hook: ReturnType<typeof mount>, name: string) {
  expect(hook.state.hidden).toEqual(models(name));
  expect(readCache()).toEqual([{ providerId: "work", name }]);
}

afterEach(() => {
  cleanup();
  configure({ reactStrictMode: false });
  localStorage.clear();
  vi.restoreAllMocks();
});

test("only the latest hidden read may update state, cache, or errors", async () => {
  const hook = mount();
  await hook.slot.behavior.emitRealtime(HIDDEN_CHANGED, null);
  await act(async () => hook.reads[1]!.resolve({ hidden: models("new") }));
  await act(async () => hook.reads[0]!.resolve({ hidden: models("old") }));
  expectHidden(hook, "new");
  await hook.slot.behavior.emitRealtime(HIDDEN_CHANGED, null);
  await hook.slot.behavior.emitRealtime(HIDDEN_CHANGED, null);
  await act(async () => hook.reads[3]!.resolve({ hidden: models("newer") }));
  await act(async () => hook.reads[2]!.reject(new Error("stale read")));
  expectHidden(hook, "newer");
  expect(hook.state.error).toBeNull();
});

test("reads started before a save cannot replace its optimistic or saved value", async () => {
  const hook = mount();
  await hook.slot.behavior.emitRealtime(HIDDEN_CHANGED, null);
  act(() => hook.state.save(models("optimistic")));
  await act(async () => hook.reads[0]!.resolve({ hidden: models("old") }));
  expectHidden(hook, "optimistic");
  await act(async () => hook.writes[0]!.resolve({ hidden: models("saved") }));
  await act(async () => hook.reads[1]!.resolve({ hidden: models("old") }));
  expectHidden(hook, "saved");
});

test.each(["resolve", "reject"] as const)(
  "rapid saves ignore an older %s and coalesce realtime reads until all writes settle",
  async (outcome) => {
    const hook = mount();
    await act(async () => hook.reads[0]!.resolve({ hidden: [] }));
    act(() => hook.state.save(models("first")));
    await hook.slot.behavior.emitRealtime(HIDDEN_CHANGED, null);
    act(() => hook.state.save(models("second")));
    await hook.slot.behavior.emitRealtime(HIDDEN_CHANGED, null);
    expect(hook.reads).toHaveLength(1);
    await act(async () => hook.writes[1]!.resolve({ hidden: models("saved") }));
    expectHidden(hook, "saved");
    expect(hook.reads).toHaveLength(1);
    await act(async () => {
      if (outcome === "resolve") hook.writes[0]!.resolve({ hidden: models("first") });
      else hook.writes[0]!.reject(new Error("old save failed"));
    });
    expectHidden(hook, "saved");
    expect(hook.state.error).toBeNull();
    expect(hook.reads).toHaveLength(2);
    await act(async () => hook.reads[1]!.resolve({ hidden: models("external") }));
    expectHidden(hook, "external");
  },
);

test("the latest save failure is reported, ignores older success, and permits retry", async () => {
  const hook = mount();
  await act(async () => hook.reads[0]!.resolve({ hidden: [] }));
  act(() => hook.state.save(models("first")));
  act(() => hook.state.save(models("second")));
  await act(async () => hook.writes[1]!.reject(new Error("save failed")));
  await act(async () => hook.writes[0]!.resolve({ hidden: models("first") }));
  expectHidden(hook, "second");
  expect(hook.state.error).toBe("save failed");
  act(() => hook.state.save(models("retry")));
  await act(async () => hook.writes[2]!.resolve({ hidden: models("retry") }));
  expectHidden(hook, "retry");
  expect(hook.state.error).toBeNull();
});

test("an earlier save and a deferred read cannot replace a newer optimistic save", async () => {
  const hook = mount();
  await act(async () => hook.reads[0]!.resolve({ hidden: [] }));
  act(() => hook.state.save(models("first")));
  act(() => hook.state.save(models("second")));
  await hook.slot.behavior.emitRealtime(HIDDEN_CHANGED, null);
  await act(async () => hook.writes[0]!.resolve({ hidden: models("first") }));
  expectHidden(hook, "second");
  expect(hook.reads).toHaveLength(1);
  await act(async () => hook.writes[1]!.resolve({ hidden: models("second") }));
  expect(hook.reads).toHaveLength(2);
  act(() => hook.state.save(models("third")));
  await act(async () => hook.reads[1]!.resolve({ hidden: models("second") }));
  expectHidden(hook, "third");
  await act(async () => hook.writes[2]!.resolve({ hidden: models("third") }));
  expectHidden(hook, "third");
});

test("realtime invalidation is released even when the current save fails", async () => {
  const hook = mount();
  await act(async () => hook.reads[0]!.resolve({ hidden: [] }));
  act(() => hook.state.save(models("failed")));
  await hook.slot.behavior.emitRealtime(HIDDEN_CHANGED, null);
  await act(async () => hook.writes[0]!.reject(new Error("save failed")));
  expect(hook.state.error).toBe("save failed");
  expect(hook.reads).toHaveLength(2);
  await act(async () => hook.reads[1]!.resolve({ hidden: models("server") }));
  expectHidden(hook, "server");
});

test("catalog refresh ignores earlier successes and failures", async () => {
  const hook = mount();
  act(() => hook.state.refetchCatalog());
  await act(async () => hook.catalogs[1]!.resolve({ providers }));
  await act(async () => hook.catalogs[0]!.resolve({ providers: [] }));
  expect(hook.state.catalog).toEqual(providers);
  act(() => hook.state.refetchCatalog());
  act(() => hook.state.refetchCatalog());
  await act(async () => hook.catalogs[3]!.resolve({ providers }));
  await act(async () => hook.catalogs[2]!.reject(new Error("old catalog")));
  expect(hook.state.catalog).toEqual(providers);
  expect(hook.state.error).toBeNull();
});

test("Strict Mode cleanup invalidates the first setup's responses", async () => {
  const hook = mount(true);
  expect(hook.reads).toHaveLength(2);
  expect(hook.catalogs).toHaveLength(2);
  await act(async () => {
    hook.reads[1]!.resolve({ hidden: models("current") });
    hook.catalogs[1]!.resolve({ providers });
  });
  await act(async () => {
    hook.reads[0]!.resolve({ hidden: models("discarded") });
    hook.catalogs[0]!.reject(new Error("discarded"));
  });
  expectHidden(hook, "current");
  expect(hook.state.catalog).toEqual(providers);
  expect(hook.state.error).toBeNull();
});

test.each(["resolve", "reject"] as const)(
  "unmount ignores %s responses and queued refreshes",
  async (outcome) => {
    const hook = mount();
    act(() => hook.state.save(models("optimistic")));
    await hook.slot.behavior.emitRealtime(HIDDEN_CHANGED, null);
    hook.slot.lifecycle.unmount();
    const changed = vi.fn();
    window.addEventListener(CHANGED_EVENT, changed);

    try {
      const savedState = hook.state;
      await act(async () => {
        if (outcome === "resolve") {
          hook.reads[0]!.resolve({ hidden: models("late read") });
          hook.writes[0]!.resolve({ hidden: models("late save") });
          hook.catalogs[0]!.resolve({ providers });
        } else {
          hook.reads[0]!.reject(new Error("late read"));
          hook.writes[0]!.reject(new Error("late save"));
          hook.catalogs[0]!.reject(new Error("late catalog"));
        }
      });
      act(() => {
        savedState.save(models("after unmount"));
        savedState.refetchCatalog();
      });
      expect(hook.state).toBe(savedState);
      expectHidden(hook, "optimistic");
      expect(changed).not.toHaveBeenCalled();
      expect(hook.reads).toHaveLength(1);
      expect(hook.writes).toHaveLength(1);
      expect(hook.catalogs).toHaveLength(1);
    } finally {
      window.removeEventListener(CHANGED_EVENT, changed);
    }
  },
);
