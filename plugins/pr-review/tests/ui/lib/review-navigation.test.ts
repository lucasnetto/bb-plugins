// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { listenForPrLinks, listenForReviewRequests } from "../../../src/ui/lib/review-navigation";

test("review handoff consumes once on mount or event, isolates threads, and removes its listener", () => {
  const url = "https://github.com/org/api/pull/42";
  const opened: unknown[] = [];
  sessionStorage.clear();
  sessionStorage.setItem("bb:pr-review:open-review:t1", url);
  sessionStorage.setItem("bb:pr-review:open-review:t2", url);
  const stop = listenForReviewRequests("t1", (request) => opened.push(request));

  try {
    expect(opened).toEqual([{ url, title: "org/api #42" }]);
    expect(sessionStorage.getItem("bb:pr-review:open-review:t1")).toBeNull();
    expect(sessionStorage.getItem("bb:pr-review:open-review:t2")).toBe(url);
    window.dispatchEvent(new Event("bb:pr-review:open-review"));
    expect(opened).toHaveLength(1);
    sessionStorage.setItem("bb:pr-review:open-review:t1", "https://example.com/not-a-pr");
    window.dispatchEvent(new Event("bb:pr-review:open-review"));
    expect(opened).toHaveLength(1);
    sessionStorage.setItem("bb:pr-review:open-review:t1", url);
    window.dispatchEvent(new Event("bb:pr-review:open-review"));
    expect(opened).toHaveLength(2);
    stop();
    sessionStorage.setItem("bb:pr-review:open-review:t1", url);
    window.dispatchEvent(new Event("bb:pr-review:open-review"));
    expect(opened).toHaveLength(2);
    expect(sessionStorage.getItem("bb:pr-review:open-review:t1")).toBe(url);
  } finally {
    stop();
    sessionStorage.clear();
  }
});

test("PR links open the panel, preserve modified clicks, and fall back when unavailable", () => {
  const anchor = document.createElement("a");
  anchor.href = "https://github.com/org/api/pull/42?foo=bar";
  const child = document.createElement("span");
  anchor.append(child);
  document.body.append(anchor);
  const opened: unknown[] = [];
  let available = true;

  const stop = listenForPrLinks((request) => {
    opened.push(request);

    return available;
  });

  // Avoid jsdom attempting browser navigation after testing the capture handler.
  anchor.addEventListener("click", (event) => event.preventDefault());

  const click = (options: MouseEventInit = {}) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...options });
    child.dispatchEvent(event);

    return event;
  };

  try {
    expect(click().defaultPrevented).toBe(true);
    expect(opened).toEqual([{ url: "https://github.com/org/api/pull/42", title: "org/api #42" }]);

    for (const options of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ])
      click(options);
    expect(opened).toHaveLength(1);
    anchor.href = "https://github.com/org/api/issues/42";
    click();
    expect(opened).toHaveLength(1);
    anchor.href = "https://github.com/org/api/pull/42";
    anchor.setAttribute("data-pr-browser", "");
    click();
    expect(opened).toHaveLength(1);
    anchor.removeAttribute("data-pr-browser");
    available = false;
    let reachedAnchor = false;
    anchor.addEventListener("click", () => {
      reachedAnchor = true;
    });
    click();
    expect(reachedAnchor).toBe(true);
    expect(opened).toHaveLength(2);
    stop();
    click();
    expect(opened).toHaveLength(2);
  } finally {
    stop();
    anchor.remove();
  }
});
