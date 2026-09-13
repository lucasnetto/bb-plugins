import type { Overview, PrStack, Timeline } from "../../shared/workspace-contract";
import { createRequestCache } from "../lib/request-cache";

export const workspaceKey = (threadId: string | null, url: string) =>
  JSON.stringify([threadId, url]);

export const overviewCache = createRequestCache<Overview>();

export const stackCache = createRequestCache<PrStack | null>();

export const timelineCache = createRequestCache<Timeline>();

// A stack action can affect several PRs, including copies open in other threads.
export function invalidateWorkspace() {
  overviewCache.invalidate();
  stackCache.invalidate();
  timelineCache.invalidate();
}
