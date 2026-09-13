import type { HiddenModel } from "../shared/contract";
import {
  PLUGIN_ID,
  STORAGE_KEY,
  CHANGED_EVENT,
  normalize,
  readCache,
  serializeCache,
  type CachedEntry,
} from "./lib/hidden-model-cache";

const MARK_ATTR = "data-bb-hide-models";

// The picker strips the provider brand prefix from labels ("GPT-5.6-Sol" →
// "5.6-Sol"), so accept an exact match or a suffix match.
const matchesHiddenModel = (title: string, hiddenModels: readonly CachedEntry[]) => {
  const label = normalize(title);

  if (label.length < 3) return false;

  return hiddenModels.some(
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

const pickerRowOf = (el: Element): { button: HTMLButtonElement; picker: Element } | null => {
  const button = el.closest("button");
  const picker = button?.closest(PICKER_ROOT) ?? null;

  return button !== null && picker !== null ? { button, picker } : null;
};

export function mountHideModels({ signal }: { signal: AbortSignal }) {
  let hiddenModels = readCache();
  let scheduledFrameId = 0;
  let lastServerRefreshAt = 0;

  const restoreHiddenRows = () => {
    document.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]`).forEach((el) => {
      el.removeAttribute(MARK_ATTR);
      el.style.removeProperty("display");
    });
  };

  const applyHiddenModelVisibility = () => {
    scheduledFrameId = 0;

    if (hiddenModels.length === 0) return;
    const hiddenModelsByPicker = new Map<Element, CachedEntry[]>();

    const hiddenModelsForPicker = (picker: Element) => {
      const cached = hiddenModelsByPicker.get(picker);

      if (cached !== undefined) return cached;
      const providerId = activeProviderIdIn(picker);

      // Unknown active provider (markup drift): fall back to every entry.
      const next =
        providerId === null
          ? hiddenModels
          : hiddenModels.filter((e) => e.providerId === providerId);

      hiddenModelsByPicker.set(picker, next);

      return next;
    };

    document.querySelectorAll<HTMLElement>("button > span[title]").forEach((span) => {
      const row = pickerRowOf(span);

      if (row === null) return;
      const el = row.button;
      const shouldHide = matchesHiddenModel(span.title, hiddenModelsForPicker(row.picker));
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

  const scheduleVisibilityUpdate = () => {
    if (scheduledFrameId !== 0) return;
    scheduledFrameId = requestAnimationFrame(applyHiddenModelVisibility);
  };

  const reloadHiddenModels = () => {
    hiddenModels = readCache();
    restoreHiddenRows();
    scheduleVisibilityUpdate();
  };

  // Best-effort server refresh so other clients/windows pick up changes made
  // elsewhere; the localStorage cache is the source the DOM filter reads.
  const refreshFromServer = () => {
    const now = Date.now();

    if (now - lastServerRefreshAt < 2_000) return;
    lastServerRefreshAt = now;
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
        reloadHiddenModels();
      })
      .catch(() => undefined);
  };

  const observer = new MutationObserver((records) => {
    scheduleVisibilityUpdate();

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
    if (event.key === STORAGE_KEY) reloadHiddenModels();
  };

  window.addEventListener("storage", onStorage, { signal });
  window.addEventListener(CHANGED_EVENT, reloadHiddenModels, { signal });

  refreshFromServer();
  scheduleVisibilityUpdate();

  return () => {
    observer.disconnect();

    if (scheduledFrameId !== 0) cancelAnimationFrame(scheduledFrameId);
    restoreHiddenRows();
  };
}
