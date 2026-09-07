/** Multirepo owns this browser protocol; the independently shipped T3 sidebar
 * implements its producer. See the Browser integration section in README.md.
 */
const OPEN_REVIEW_EVENT = "bb:multirepo:open-review";
type ReviewRequest = { url: string; title: string };

export function listenForReviewRequests(
  threadId: string,
  openReview: (request: ReviewRequest) => void,
): () => void {
  const key = `${OPEN_REVIEW_EVENT}:${threadId}`;
  const consume = () => {
    const url = sessionStorage.getItem(key);
    if (!url) return;
    sessionStorage.removeItem(key);
    const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)$/.exec(url);
    if (match) openReview({ url, title: `${match[1]} #${match[2]}` });
  };
  // Read on mount for navigation to a different thread; listen for same-thread clicks.
  consume();
  window.addEventListener(OPEN_REVIEW_EVENT, consume);
  return () => window.removeEventListener(OPEN_REVIEW_EVENT, consume);
}
