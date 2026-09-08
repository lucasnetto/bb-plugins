import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Schema } from "effect";
import { draftCommentsSchema, type DraftComment } from "../../shared/review-draft-contract";

const changedEvent = "bb:pr-review:draft-comments";
const keyFor = (url: string) => `bb:pr-review:review-comments:v1:${url}`;
const decode = Schema.decodeUnknownSync(draftCommentsSchema);
function parse(raw: string | null): DraftComment[] {
  if (!raw) return [];
  return decode(JSON.parse(raw));
}
function save(url: string, comments: DraftComment[]) {
  const value = decode(comments);
  if (value.length) sessionStorage.setItem(keyFor(url), JSON.stringify(value));
  else sessionStorage.removeItem(keyFor(url));
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: url }));
}
export function useDraftComments(url: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const onChange = (event: Event) => {
        if (event instanceof CustomEvent && event.detail === url) listener();
      };
      window.addEventListener(changedEvent, onChange);
      return () => window.removeEventListener(changedEvent, onChange);
    },
    [url],
  );
  const snapshot = useCallback(() => sessionStorage.getItem(keyFor(url)), [url]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const { comments, error } = useMemo(() => {
    try {
      return { comments: parse(raw), error: "" };
    } catch {
      return {
        comments: [],
        error: "Saved review comments could not be read. Clear them to continue.",
      };
    }
  }, [raw]);
  const add = useCallback(
    (comment: DraftComment) => {
      save(url, [...parse(sessionStorage.getItem(keyFor(url))), comment]);
    },
    [url],
  );
  const remove = (ids: string[]) =>
    save(
      url,
      parse(sessionStorage.getItem(keyFor(url))).filter((comment) => !ids.includes(comment.id)),
    );
  return { comments, error, add, remove, clear: () => save(url, []) };
}
