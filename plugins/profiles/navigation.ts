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
