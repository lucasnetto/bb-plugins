import { useEffect } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { parsePrUrl } from "../../shared/links-contract";

// Public browser integration used by the independently shipped PR Review plugin.
export const OPEN_DRAFT_EVENT = "bb:multirepo:open-draft";
export const reviewDraftTab = { panelId: "review", id: "code" } as const;
export function draftPath(url: string): string {
  const ref = parsePrUrl(url);
  return `${ref.repository}/${ref.number}`;
}
export function draftUrl(subPath: string): string | null {
  const match = /^\/?([\w.-]+\/[\w.-]+)\/([1-9]\d*)\/?$/.exec(subPath);
  if (!match) return null;
  try {
    return parsePrUrl(`https://github.com/${match[1]}/pull/${match[2]}`).url;
  } catch {
    return null;
  }
}
export function ReviewDraftNavigation() {
  const navigate = useBbNavigate();
  useEffect(() => {
    const open = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail?.url !== "string") return;
      try {
        const { url } = parsePrUrl(event.detail.url);
        navigate.toPluginPanel("review", { subPath: draftPath(url) });
        event.preventDefault();
      } catch {
        /* Ignore invalid requests; the caller reports an unaccepted open. */
      }
    };
    window.addEventListener(OPEN_DRAFT_EVENT, open);
    return () => window.removeEventListener(OPEN_DRAFT_EVENT, open);
  }, [navigate]);
  return null;
}
