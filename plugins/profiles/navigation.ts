export function destinationUrl(remoteUrl: string, localUrl: string, currentHostname: string): string {
  return ["localhost", "127.0.0.1", "[::1]"].includes(currentHostname) ? localUrl : remoteUrl;
}

export const LAST_THREAD_KEY = "bb-profiles:last-thread:v1";
export const RESUME_PARAM = "bb-profile-resume";

export function profileSwitchUrl(remoteUrl: string, localUrl: string, currentHostname: string): string {
  const url = new URL(destinationUrl(remoteUrl, localUrl, currentHostname));
  url.searchParams.set(RESUME_PARAM, "1");
  return url.href;
}

export function savedThreadPath(value: string | null): string | null {
  // Only allow local thread routes, never arbitrary URLs from browser storage.
  return value && /^\/projects\/[A-Za-z0-9_-]+\/threads\/[A-Za-z0-9_-]+$/.test(value) ? value : null;
}


export function resumeThread(
  browser: Pick<Window, "location" | "history" | "localStorage">,
  toThread: (threadId: string) => void,
): void {
  const url = new URL(browser.location.href);
  if (url.pathname !== "/" || url.searchParams.get(RESUME_PARAM) !== "1") return;
  let path: string | null = null;
  try { path = savedThreadPath(browser.localStorage.getItem(LAST_THREAD_KEY)); } catch { /* Fall back to New thread. */ }
  // Consume the marker before navigating so remounts and Back cannot restore twice.
  url.searchParams.delete(RESUME_PARAM);
  browser.history.replaceState(browser.history.state, "", url.href);
  // The host router opens the thread without bootstrapping the destination app again.
  if (path) toThread(path.split("/")[4]!);
}
