import { useMemo } from "react";
import type { CatalogProvider } from "../../shared/contract";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import { useHiddenModels } from "../hooks/useHiddenModels";
const keyOf = (providerId: string, model: string) => `${providerId}\u0000${model}`;

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
          {provider.loadError ? `No models (${provider.loadError}).` : "No models discovered."}
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

export function HideModelsSettings() {
  const { catalog, hidden, error, save, refetchCatalog } = useHiddenModels();
  const hiddenKeys = useMemo(
    () => new Set((hidden ?? []).map((e) => keyOf(e.providerId, e.model))),
    [hidden],
  );

  const toggle =
    (provider: CatalogProvider) => (model: CatalogProvider["models"][number], hide: boolean) => {
      const current = hidden ?? [];
      const key = keyOf(provider.id, model.model);
      const without = current.filter((e) => keyOf(e.providerId, e.model) !== key);
      save(
        hide
          ? [
              ...without,
              { providerId: provider.id, model: model.model, displayName: model.displayName },
            ]
          : without,
      );
    };

  // Entries whose provider/model no longer appears in the catalog.
  const stale = useMemo(() => {
    if (catalog === null || hidden === null) return [];
    const known = new Set(catalog.flatMap((p) => p.models.map((m) => keyOf(p.id, m.model))));
    return hidden.filter((e) => !known.has(keyOf(e.providerId, e.model)));
  }, [catalog, hidden]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Unchecked models are hidden from the picker. Discovery is unchanged; a hidden model stays
          selectable via CLI/SDK and remains the provider default if it is one.
        </p>
        <Button variant="ghost" size="sm" onClick={refetchCatalog} disabled={catalog === null}>
          <Icon name="ArrowReloadHorizontal" className="size-4" />
          Refresh
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {catalog === null ? (
        <p
          role="status"
          className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
        >
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
              {stale.length} hidden {stale.length === 1 ? "entry" : "entries"} no longer in any
              catalog.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => save((hidden ?? []).filter((e) => !stale.includes(e)))}
            >
              Remove
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
