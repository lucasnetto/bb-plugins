import { useCallback, useEffect, useRef, useState } from "react";
import { Match } from "effect";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import type { GithubReviewAction, GithubReviewState } from "../../shared/github-review-contract";

export function useGithubReview(threadId: string | null, url: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<GithubReviewState | null>(null);
  const [error, setError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  const [open, setOpen] = useState(false);
  const alive = useRef(true);
  const writing = useRef(false);
  const generation = useRef(0);
  const reading = useRef(false);

  const refresh = useCallback(async () => {
    if (reading.current || writing.current) return;
    reading.current = true;
    const current = ++generation.current;

    try {
      const next = await rpc.call("githubReview", { threadId, url });

      if (!alive.current || current !== generation.current) return;
      setState((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      setSynced(true);
      setError("");
    } catch (cause) {
      if (alive.current && current === generation.current) {
        setError(`Could not refresh GitHub review: ${String(cause)}`);
        setSynced(false);
      }
    } finally {
      reading.current = false;

      if (alive.current && current !== generation.current && !writing.current) void refresh();
    }
  }, [rpc, threadId, url]);

  useEffect(() => {
    alive.current = true;
    void refresh();

    const onFocus = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };

    const timer = window.setInterval(onFocus, 30000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      alive.current = false;
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const mutate = async (action: GithubReviewAction) => {
    if (writing.current || !synced) return false;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setNotice("Saving…");
    setWriteError("");

    try {
      const receipt = await rpc.call("githubReviewMutate", { threadId, url, action });

      if (alive.current) {
        if (action.kind === "submit") setPublishedUrl(receipt.url);
        setSynced(false);
        setNotice(
          Match.value(action.kind).pipe(
            Match.when("submit", () => "Review submitted to GitHub."),
            Match.when("discard", () => "Review discarded on GitHub."),
            Match.orElse(() => "Saved to GitHub."),
          ),
        );
      }

      return true;
    } catch (cause) {
      if (alive.current) {
        setNotice("");
        setWriteError(
          `Could not confirm the save: ${String(cause)}. Refresh before retrying; GitHub may have received it.`,
        );
        setSynced(false);
      }

      return false;
    } finally {
      writing.current = false;

      if (alive.current) setBusy(false);

      // Do not retry writes. Read the authoritative state, independently of the write result.
      if (!reading.current) void refresh();
    }
  };

  return {
    state,
    publishedUrl,
    error: writeError || error,
    notice,
    busy,
    synced,
    refresh,
    mutate,
    open,
    setOpen,
  };
}
