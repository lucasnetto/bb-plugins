const actionSelector = "[data-thread-header-workflow-actions] [data-thread-header-responsive-action]";
const marker = "data-bb-t3-hide-commit";

// BB has no header-action removal API. Keep this DOM enhancement narrowly
// scoped to its responsive workflow controls; never touch menus or dialogs.
export function hideHeaderCommit() {
  const style = document.createElement("style");
  style.textContent = `[${marker}] { display: none !important; }`;
  document.head.append(style);
  const marked = new Set<Element>();

  const sync = () => {
    const targets = new Set<Element>();
    for (const action of document.querySelectorAll(actionSelector)) {
      const buttons = [...action.querySelectorAll("button")];
      const commits = buttons.filter((button) => button.textContent?.trim() === "Commit");
      if (commits.length && commits.length === buttons.length) targets.add(action);
      else for (const button of commits) targets.add(button);
    }
    for (const element of marked) {
      if (!targets.has(element)) {
        element.removeAttribute(marker);
        marked.delete(element);
      }
    }
    for (const element of targets) {
      element.setAttribute(marker, "");
      marked.add(element);
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    for (const element of marked) element.removeAttribute(marker);
    style.remove();
  };
}
