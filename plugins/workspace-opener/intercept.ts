const EDITORS = new Set(["cursor", "vscode", "vscode-insiders"]);

type OpenPayload = {
  path: string;
  targetId: string;
  lineNumber?: number | null;
  columnNumber?: number | null;
  context: { kind: "local" } | { kind: "remote-ssh"; hostId: string; serverOrigin: string };
};

function openPayload(value: unknown): value is OpenPayload {
  if (!value || typeof value !== "object") return false;
  const p = value as OpenPayload;
  return (
    typeof p.path === "string" &&
    EDITORS.has(p.targetId) &&
    (p.targetId === "cursor" || (p.lineNumber == null && p.columnNumber == null)) &&
    (p.context?.kind === "local" ||
      (p.context?.kind === "remote-ssh" &&
        typeof p.context.hostId === "string" &&
        typeof p.context.serverOrigin === "string"))
  );
}

/** Internal BB transport adapter. Unknown requests pass through unchanged. */
export function mountWorkspaceOpener(
  { signal }: { signal: AbortSignal },
  scope: Pick<Window, "fetch" | "location"> = window,
) {
  const original = scope.fetch;
  const fetchOriginal = original.bind(scope);
  let active = true;
  const wrapper: typeof fetch = async (input, init) => {
    let next = init;
    let localCursor = false;
    // BB sends a JSON string with fetch(url, init). Never consume body streams.
    if (active && !signal.aborted && typeof init?.body === "string" && init.method === "POST") {
      try {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          scope.location.href,
        );
        if (
          url.pathname === "/open-in-target" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ) {
          const payload: unknown = JSON.parse(init.body);
          if (openPayload(payload)) {
            localCursor = payload.targetId === "cursor" && payload.context.kind === "local";
            const lookupSignal = AbortSignal.any([
              signal,
              AbortSignal.timeout(2500),
              ...(init.signal ? [init.signal] : []),
            ]);
            let hostId: string;
            if (payload.context.kind === "remote-ssh") {
              if (new URL(payload.context.serverOrigin).origin !== scope.location.origin) {
                return fetchOriginal(input, init);
              }
              hostId = payload.context.hostId;
            } else {
              const response = await fetchOriginal(new URL("/status", url), {
                signal: lookupSignal,
              });
              if (!response.ok) throw new Error("Local BB helper is unavailable");
              const status = await response.json();
              if (typeof status.hostId !== "string")
                throw new Error("Local BB helper did not identify its host");
              hostId = status.hostId;
            }
            if (payload.targetId === "cursor" && payload.context.kind === "local") {
              // Once dispatched, never retry via BB: a lost response could
              // otherwise open a second window in Glass.
              signal.throwIfAborted();
              init.signal?.throwIfAborted();

              const launched = await fetchOriginal(
                new URL("/api/v1/plugins/workspace-opener/http/open-cursor", scope.location.href),
                {
                  method: "POST",
                  credentials: "include",
                  headers: { "content-type": "application/json" },
                  signal: AbortSignal.any([
                    signal,
                    AbortSignal.timeout(20000),
                    ...(init.signal ? [init.signal] : []),
                  ]),
                  body: JSON.stringify({
                    hostId,
                    path: payload.path,
                    lineNumber: payload.lineNumber,
                    columnNumber: payload.columnNumber,
                  }),
                },
              );
              if (!launched.ok) throw new Error("Could not open the Cursor IDE");
              return Response.json({});
            }
            const response = await fetchOriginal(
              new URL("/api/v1/plugins/workspace-opener/http/resolve", scope.location.href),
              {
                method: "POST",
                credentials: "include",
                signal: lookupSignal,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ hostId, path: payload.path }),
              },
            );
            if (response.ok) {
              const result = await response.json();
              if (
                active &&
                !signal.aborted &&
                typeof result.path === "string" &&
                result.path.endsWith(".code-workspace")
              ) {
                next = { ...init, body: JSON.stringify({ ...payload, path: result.path }) };
              }
            }
          }
        }
      } catch (error) {
        if (localCursor) throw error;
        // Lookup, compatibility, and connectivity failures retain BB's action.
      }
    }
    return fetchOriginal(input, next);
  };
  scope.fetch = wrapper;
  const dispose = () => {
    active = false;
    if (scope.fetch === wrapper) scope.fetch = original;
    signal.removeEventListener("abort", dispose);
  };
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
