// bb-plugin-hide-models — frontend.
//
// Two surfaces:
// - settingsSection: per-provider checkboxes on the plugin's settings page.
// - contentScript: hides matching rows in bb's model picker. Discovery stays
//   untouched; this is a UI-only filter.
import { useCallback, useEffect, useMemo, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { CatalogProvider, HiddenModel, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const PLUGIN_ID = "hide-models";
const STORAGE_KEY = `bb-plugin-${PLUGIN_ID}:hidden-names`;
const CHANGED_EVENT = `bb-plugin-${PLUGIN_ID}:changed`;
const MARK_ATTR = "data-bb-hide-models";
const HIDDEN_CHANGED = "hidden-changed";

// ---------------------------------------------------------------------------
// Shared: local cache of hidden display names (what the content script reads)

type CachedEntry = { providerId: string; name: string };

const normalize = (label: string) =>
  label.split(" · ")[0]?.trim().toLowerCase() ?? "";

const serializeCache = (hidden: readonly HiddenModel[]) =>
  JSON.stringify(
    hidden.map((entry): CachedEntry => ({
      providerId: entry.providerId,
      name: normalize(entry.displayName),
    })),
  );

const readCache = (): CachedEntry[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (x): x is CachedEntry =>
            typeof x === "object" &&
            x !== null &&
            typeof x.providerId === "string" &&
            typeof x.name === "string",
        )
      : [];
  } catch {
    return [];
  }
};

const writeCache = (hidden: readonly HiddenModel[]) => {
  localStorage.setItem(STORAGE_KEY, serializeCache(hidden));
  window.dispatchEvent(new Event(CHANGED_EVENT));
};

// ---------------------------------------------------------------------------
// Content script

// The picker strips the provider brand prefix from labels ("GPT-5.6-Sol" →
// "5.6-Sol"), so accept an exact match or a suffix match.
const matches = (title: string, entries: readonly CachedEntry[]) => {
  const label = normalize(title);
  if (label.length < 3) return false;
  return entries.some(
    ({ name }) => name === label || (label.length >= 4 && name.endsWith(label)),
  );
};

// Provider tabs: `<button title="Codex"><span data-provider-logo="/api/v1/system/providers/<id>/logo…">`;
// the active tab swaps `border-transparent` for `border-foreground`.
const activeProviderIdIn = (picker: Element): string | null => {
  const logo = Array.from(
    picker.querySelectorAll<HTMLElement>("button.border-foreground [data-provider-logo]"),
  )[0];
  const match = logo?.dataset.providerLogo?.match(/\/providers\/([^/]+)\/logo/);
  return match ? decodeURIComponent(match[1]) : null;
};

// bb's picker row is `<button role="option"?><span title="Label[ · qualifier]">…`.
const PICKER_ROOT = "[data-radix-popper-content-wrapper], [role='dialog']";

const pickerRowOf = (
  el: Element,
): { button: HTMLButtonElement; picker: Element } | null => {
  const button = el.closest("button");
  const picker = button?.closest(PICKER_ROOT) ?? null;
  return button !== null && picker !== null ? { button, picker } : null;
};

function mountHideModels({ signal }: { signal: AbortSignal }) {
  let entries = readCache();
  let frame = 0;
  let lastFetch = 0;

  const unmark = () => {
    document.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]`).forEach((el) => {
      el.removeAttribute(MARK_ATTR);
      el.style.removeProperty("display");
    });
  };

  const apply = () => {
    frame = 0;
    if (entries.length === 0) return;
    const scoped = new Map<Element, CachedEntry[]>();
    const entriesFor = (picker: Element) => {
      const cached = scoped.get(picker);
      if (cached !== undefined) return cached;
      const providerId = activeProviderIdIn(picker);
      // Unknown active provider (markup drift): fall back to every entry.
      const next =
        providerId === null ? entries : entries.filter((e) => e.providerId === providerId);
      scoped.set(picker, next);
      return next;
    };
    document.querySelectorAll<HTMLElement>("button > span[title]").forEach((span) => {
      const row = pickerRowOf(span);
      if (row === null) return;
      const el = row.button;
      const shouldHide = matches(span.title, entriesFor(row.picker));
      const isHidden = el.hasAttribute(MARK_ATTR);
      if (shouldHide && !isHidden) {
        el.setAttribute(MARK_ATTR, "");
        el.style.setProperty("display", "none", "important");
      } else if (!shouldHide && isHidden) {
        el.removeAttribute(MARK_ATTR);
        el.style.removeProperty("display");
      }
    });
  };

  const schedule = () => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(apply);
  };

  const reload = () => {
    entries = readCache();
    unmark();
    schedule();
  };

  // Best-effort server refresh so other clients/windows pick up changes made
  // elsewhere; the localStorage cache is the source the DOM filter reads.
  const refreshFromServer = () => {
    const now = Date.now();
    if (now - lastFetch < 2_000) return;
    lastFetch = now;
    fetch(`/api/v1/plugins/${PLUGIN_ID}/http/hidden`, {
      credentials: "include",
      signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { hidden?: HiddenModel[] } | null) => {
        if (body?.hidden === undefined) return;
        const next = serializeCache(body.hidden);
        if (next === localStorage.getItem(STORAGE_KEY)) return;
        localStorage.setItem(STORAGE_KEY, next);
        reload();
      })
      .catch(() => undefined);
  };

  const observer = new MutationObserver((records) => {
    schedule();
    const pickerOpened = records.some((record) =>
      Array.from(record.addedNodes).some(
        (node) =>
          node instanceof Element &&
          node.querySelector("input[aria-label='Search models']") !== null,
      ),
    );
    if (pickerOpened) refreshFromServer();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    // `class` covers the active provider tab switching.
    attributeFilter: ["title", "class"],
  });

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) reload();
  };
  window.addEventListener("storage", onStorage, { signal });
  window.addEventListener(CHANGED_EVENT, reload, { signal });

  refreshFromServer();
  schedule();

  return () => {
    observer.disconnect();
    if (frame !== 0) cancelAnimationFrame(frame);
    unmark();
  };
}

// ---------------------------------------------------------------------------
// Settings section

const keyOf = (providerId: string, model: string) => `${providerId}\u0000${model}`;

function useHiddenModels() {
  const rpc = useRpc<typeof rpcContract>();
  const [catalog, setCatalog] = useState<CatalogProvider[] | null>(null);
  const [hidden, setHidden] = useState<HiddenModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const refetchHidden = useCallback(() => {
    rpc.call("hidden_get").then((result) => {
      setHidden(result.hidden);
      writeCache(result.hidden);
      setError(null);
    }, report);
  }, [rpc, report]);

  const refetchCatalog = useCallback(() => {
    setCatalog(null);
    rpc.call("catalog").then((result) => {
      setCatalog(result.providers);
      setError(null);
    }, report);
  }, [rpc, report]);

  useEffect(() => {
    refetchHidden();
    refetchCatalog();
  }, [refetchHidden, refetchCatalog]);
  useRealtime(HIDDEN_CHANGED, refetchHidden);

  const save = useCallback(
    (next: HiddenModel[]) => {
      setHidden(next);
      writeCache(next);
      rpc.call("hidden_set", { hidden: next }).then((result) => {
        setHidden(result.hidden);
        writeCache(result.hidden);
      }, report);
    },
    [rpc, report],
  );

  return { catalog, hidden, error, save, refetchCatalog };
}

function ProviderCard({
  provider,
  hiddenKeys,
  onToggle,
}: {
  provider: CatalogProvider;
  hiddenKeys: ReadonlySet<string>;
  onToggle: (model: CatalogProvider["models"][number], hide: boolean) => void;
}) {
  const hiddenCount = provider.models.filter((m) =>
    hiddenKeys.has(keyOf(provider.id, m.model)),
  ).length;
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{provider.displayName}</h3>
          <p className="truncate font-mono text-xs text-muted-foreground">{provider.id}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {hiddenCount === 0
            ? `${provider.models.length} visible`
            : `${hiddenCount} of ${provider.models.length} hidden`}
        </span>
      </header>
      {provider.models.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {provider.loadError
            ? `No models (${provider.loadError}).`
            : "No models discovered."}
        </p>
      ) : (
        <ul className="divide-y divide-border px-4">
          {provider.models.map((model) => {
            const isHidden = hiddenKeys.has(keyOf(provider.id, model.model));
            const id = `hide-models-${provider.id}-${model.model}`;
            return (
              <li key={model.model} className="flex items-center gap-3 py-2 text-sm">
                <Checkbox
                  id={id}
                  checked={!isHidden}
                  onCheckedChange={(checked) => onToggle(model, checked !== true)}
                  aria-label={`${isHidden ? "Show" : "Hide"} ${model.displayName}`}
                />
                <label
                  htmlFor={id}
                  className={cn(
                    "flex min-w-0 flex-1 cursor-pointer items-baseline gap-2",
                    isHidden && "text-muted-foreground",
                  )}
                >
                  <span className={cn("truncate", isHidden && "line-through")}>
                    {model.displayName}
                  </span>
                  {model.isDefault ? (
                    <span className="shrink-0 text-xs text-muted-foreground">default</span>
                  ) : null}
                </label>
                <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
                  {model.model}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HideModelsSettings() {
  const { catalog, hidden, error, save, refetchCatalog } = useHiddenModels();
  const hiddenKeys = useMemo(
    () => new Set((hidden ?? []).map((e) => keyOf(e.providerId, e.model))),
    [hidden],
  );

  const toggle =
    (provider: CatalogProvider) =>
    (model: CatalogProvider["models"][number], hide: boolean) => {
      const current = hidden ?? [];
      const key = keyOf(provider.id, model.model);
      const without = current.filter((e) => keyOf(e.providerId, e.model) !== key);
      save(
        hide
          ? [...without, { providerId: provider.id, model: model.model, displayName: model.displayName }]
          : without,
      );
    };

  // Entries whose provider/model no longer appears in the catalog.
  const stale = useMemo(() => {
    if (catalog === null || hidden === null) return [];
    const known = new Set(
      catalog.flatMap((p) => p.models.map((m) => keyOf(p.id, m.model))),
    );
    return hidden.filter((e) => !known.has(keyOf(e.providerId, e.model)));
  }, [catalog, hidden]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Unchecked models are hidden from the picker. Discovery is unchanged;
          a hidden model stays selectable via CLI/SDK and remains the provider default if it is one.
        </p>
        <Button variant="ghost" size="sm" onClick={refetchCatalog} disabled={catalog === null}>
          <Icon name="ArrowReloadHorizontal" className="size-4" />
          Refresh
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}
      {catalog === null ? (
        <p role="status" className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Loading providers…
        </p>
      ) : (
        catalog.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            hiddenKeys={hiddenKeys}
            onToggle={toggle(provider)}
          />
        ))
      )}
      {stale.length === 0 ? null : (
        <section className="rounded-lg border border-border bg-card px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {stale.length} hidden {stale.length === 1 ? "entry" : "entries"} no longer in any catalog.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                save((hidden ?? []).filter((e) => !stale.includes(e)))
              }
            >
              Remove
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "hide-picker-rows", mount: mountHideModels });
  app.slots.settingsSection({
    id: "hidden-models",
    title: "Hidden models",
    description: "Choose which models each provider shows in bb's model picker.",
    component: HideModelsSettings,
  });
});
