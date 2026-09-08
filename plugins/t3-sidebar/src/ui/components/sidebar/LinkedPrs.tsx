import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { experimental_useSidebarThreads, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
type SidebarPr = {
  url: string;
  repository: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged" | "draft";
};
type LinkMap = Record<string, SidebarPr[]>;
function parseLinks(value: unknown): LinkMap {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid linked PR response");
  const result: LinkMap = {};
  for (const [id, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) throw new Error("Invalid linked PR list");
    result[id] = entries.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") throw new Error("Invalid linked PR");
      const pr = entry as Record<string, unknown>;
      if (
        typeof pr.url !== "string" ||
        !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/.test(pr.url) ||
        typeof pr.repository !== "string" ||
        typeof pr.number !== "number" ||
        typeof pr.title !== "string" ||
        typeof pr.isDraft !== "boolean" ||
        !["OPEN", "CLOSED", "MERGED"].includes(String(pr.state))
      )
        throw new Error("Invalid linked PR");
      return {
        url: pr.url,
        repository: pr.repository,
        number: pr.number,
        title: pr.title,
        state:
          pr.state === "MERGED"
            ? "merged"
            : pr.state === "CLOSED"
              ? "closed"
              : pr.isDraft
                ? "draft"
                : "open",
      };
    });
  }
  return result;
}
const LinkedContext = createContext<LinkMap>({});
export function LinkedPrProvider({ children }: { children: ReactNode }) {
  const { threads } = experimental_useSidebarThreads();
  const connection = useRealtimeConnectionState();
  const ids = JSON.stringify(threads.map((t) => t.id).sort());
  const [links, setLinks] = useState<LinkMap>({});
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      fetch("/api/v1/plugins/pr-review/http/linked-prs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadIds: JSON.parse(ids) }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Linked PRs unavailable");
          return parseLinks(await response.json());
        })
        .then(setLinks)
        .catch((error) => {
          if (error?.name !== "AbortError") setLinks({});
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("bb:pr-review:links-changed", refresh);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("bb:pr-review:links-changed", refresh);
    };
  }, [ids, connection]);
  return <LinkedContext.Provider value={links}>{children}</LinkedContext.Provider>;
}
export function useLinkedPrs(threadId: string) {
  return useContext(LinkedContext)[threadId] ?? [];
}
