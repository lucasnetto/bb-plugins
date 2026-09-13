/** PrReview owns this browser protocol; the independently shipped T3 sidebar
 * implements its producer. See the Browser integration section in README.md.
 */
const OPEN_REVIEW_EVENT = "bb:pr-review:open-review";

type ReviewRequest = { url: string; title: string };

/** Capture before the host's link handler, leaving modified clicks to the browser. */
export function listenForPrLinks(openReview: (request: ReviewRequest) => boolean): () => void {
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;

    const anchor = event
      .composedPath()
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);

    if (!anchor || anchor.hasAttribute("download") || anchor.hasAttribute("data-pr-browser"))
      return;

    const match =
      /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)\/?(?:[?#].*)?$/.exec(
        anchor.href,
      );

    if (!match) return;
    const url = `https://github.com/${match[1]}/pull/${match[2]}`;

    if (!openReview({ url, title: `${match[1]} #${match[2]}` })) return;
    event.preventDefault();
    event.stopPropagation();
  };

  document.addEventListener("click", click, true);

  return () => document.removeEventListener("click", click, true);
}

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
