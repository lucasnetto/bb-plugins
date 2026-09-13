import { Schema } from "effect";
import type { HiddenModel } from "../../shared/contract";

export const PLUGIN_ID = "hide-models";

export const STORAGE_KEY = `bb-plugin-${PLUGIN_ID}:hidden-names`;

export const CHANGED_EVENT = `bb-plugin-${PLUGIN_ID}:changed`;

const CachedEntry = Schema.Struct({ providerId: Schema.String, name: Schema.String });

export type CachedEntry = typeof CachedEntry.Type;

const isCachedEntry = Schema.is(CachedEntry);

const isCacheArray = Schema.is(Schema.Array(Schema.Unknown));

export const normalize = (label: string) => label.split(" · ")[0]?.trim().toLowerCase() ?? "";

export const serializeCache = (hidden: readonly HiddenModel[]) =>
  JSON.stringify(
    hidden.map((entry): CachedEntry => ({
      providerId: entry.providerId,
      name: normalize(entry.displayName),
    })),
  );

export const readCache = (): CachedEntry[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");

    return isCacheArray(parsed) ? parsed.filter(isCachedEntry) : [];
  } catch {
    return [];
  }
};

export const writeCache = (hidden: readonly HiddenModel[]) => {
  localStorage.setItem(STORAGE_KEY, serializeCache(hidden));
  window.dispatchEvent(new Event(CHANGED_EVENT));
};
