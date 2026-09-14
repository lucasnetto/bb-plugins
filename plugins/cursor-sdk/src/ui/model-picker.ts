// BB currently includes selected-only legacy presets in the picker. Keep their
// IDs available to saved threads, but show one row per model/configuration.
const marker = "data-cursor-sdk-duplicate";

export function mountModelPicker() {
  let frame = 0;
  const restore = () => {
    document.querySelectorAll<HTMLElement>(`[${marker}]`).forEach((row) => {
      row.removeAttribute(marker);
    });
  };
  const apply = () => {
    frame = 0;
    restore();
    document.querySelectorAll('[role="dialog"]').forEach((picker) => {
      if (!picker.querySelector('button[title="Cursor SDK"].border-foreground')) return;
      const active = picker
        .querySelector('[role="combobox"]')
        ?.getAttribute("aria-activedescendant");
      const groups = new Map<string, HTMLElement[]>();
      picker.querySelectorAll<HTMLElement>('button[role="option"]').forEach((row) => {
        const title = row.querySelector("span[title]")?.getAttribute("title");
        if (title) groups.set(title, [...(groups.get(title) ?? []), row]);
      });
      for (const rows of groups.values()) {
        const keep =
          rows.find((row) => row.id === active) ??
          rows.find((row) => row.getAttribute("aria-selected") === "true") ??
          rows[0];
        for (const row of rows) {
          if (row === keep) continue;
          row.setAttribute(marker, "");
        }
      }
    });
  };
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(apply);
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title", "class", "aria-selected", "aria-activedescendant"],
  });
  apply();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    restore();
  };
}
