import { parsePrUrl } from "../../shared/links-contract";

export const reviewDraftTab = { panelId: "review", id: "code" } as const;
export function draftPath(url: string): string {
  const ref = parsePrUrl(url);
  return `${ref.repository}/${ref.number}`;
}
export function draftUrl(subPath: string): string | null {
  const match = /^\/?([\w.-]+\/[\w.-]+)\/([1-9]\d*)\/?$/.exec(subPath);
  if (!match) return null;
  try {
    return parsePrUrl(`https://github.com/${match[1]}/pull/${match[2]}`).url;
  } catch {
    return null;
  }
}
