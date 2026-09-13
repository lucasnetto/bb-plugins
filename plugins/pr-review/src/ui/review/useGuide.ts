import { useCallback, useState } from "react";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { Schema } from "effect";
import { GUIDE_CHANGED, guideTarget } from "../../shared/guide-contract";
import { useSavedGuide } from "./useSavedGuide";
import { useGuideGeneration } from "./useGuideGeneration";

/** Coordinate shared invalidation and keep guide mutations mutually exclusive. */
export function useGuide(threadId: string | null, url: string, revision: number) {
  const [refreshRevision, setRefreshRevision] = useState(0);
  const refresh = useCallback(() => setRefreshRevision((value) => value + 1), []);
  useRealtime(GUIDE_CHANGED, (payload) => {
    if (Schema.is(guideTarget)(payload) && payload.threadId === threadId && payload.url === url)
      refresh();
  });
  const saved = useSavedGuide(threadId, url, revision, refreshRevision, refresh);

  const generation = useGuideGeneration(
    threadId,
    url,
    refreshRevision,
    refresh,
    saved.savingProgress,
  );

  const mutationPending = saved.savingProgress || generation.starting || generation.cancelling;

  return {
    ...saved,
    generation,
    mutationPending,
    mark: async (chapter: number, reviewed: boolean) => {
      if (!mutationPending) await saved.mark(chapter, reviewed);
    },
  };
}
