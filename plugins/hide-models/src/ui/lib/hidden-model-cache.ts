import type { HiddenModel } from "../../shared/contract";
export const PLUGIN_ID = "hide-models";
export const STORAGE_KEY = `bb-plugin-${PLUGIN_ID}:hidden-names`;
export const CHANGED_EVENT = `bb-plugin-${PLUGIN_ID}:changed`;

export type CachedEntry = { providerId: string; name: string };

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

export const writeCache = (hidden: readonly HiddenModel[]) => {
  localStorage.setItem(STORAGE_KEY, serializeCache(hidden));
  window.dispatchEvent(new Event(CHANGED_EVENT));
};
