import { Match, Schema } from "effect";
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

const linkedPrSchema = Schema.Struct({
  url: Schema.String.check(
    Schema.isPattern(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/),
  ),
  repository: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  isDraft: Schema.Boolean,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
});

const linkedPrResponseSchema = Schema.Record(Schema.String, Schema.Array(linkedPrSchema));

type LinkedPrResponse = typeof linkedPrResponseSchema.Type;

function parseLinks(value: LinkedPrResponse) {
  const result: LinkMap = {};

  for (const [id, entries] of Object.entries(value)) {
    result[id] = entries.map((pr): SidebarPr => ({
      url: pr.url,
      repository: pr.repository,
      number: pr.number,
      title: pr.title,
      state: Match.value(pr.state).pipe(
        Match.when("MERGED", () => "merged" as const),
        Match.when("CLOSED", () => "closed" as const),
        Match.when("OPEN", () => (pr.isDraft ? ("draft" as const) : ("open" as const))),
        Match.exhaustive,
      ),
    }));
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
      const request = new AbortController();
      controller = request;
      fetch("/api/v1/plugins/pr-review/http/linked-prs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadIds: JSON.parse(ids) }),
        signal: request.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Linked PRs unavailable");

          return parseLinks(
            Schema.decodeUnknownSync(linkedPrResponseSchema)(await response.json()),
          );
        })
        .then((value) => {
          if (!request.signal.aborted) setLinks(value);
        })
        .catch((error) => {
          if (!request.signal.aborted && error?.name !== "AbortError") setLinks({});
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
