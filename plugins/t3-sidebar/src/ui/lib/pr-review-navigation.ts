// External browser protocol owned by PR Review; see plugins/pr-review/README.md.
// Keep this adapter local so either plugin can be distributed independently.
const OPEN_REVIEW_EVENT = "bb:pr-review:open-review";

export function requestLinkedReview(
  threadId: string,
  url: string,
  openThread: (threadId: string) => void,
): void {
  // The target header may mount during navigation. Store first, then navigate;
  // the event also reaches an already-mounted header when opening the same thread.
  sessionStorage.setItem(`${OPEN_REVIEW_EVENT}:${threadId}`, url);
  openThread(threadId);
  window.dispatchEvent(new Event(OPEN_REVIEW_EVENT));
}
