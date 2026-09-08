import { useMemo, useState } from "react";
import {
  parseDiffFromFile,
  type FileDiffMetadata,
  type FileDiffContentsLoader,
} from "@pierre/diffs";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import type { LinkedDetail } from "../../shared/links-contract";

const contentsCache = new WeakMap<LinkedDetail, Map<string, FileDiffMetadata>>();

/** Load full file contents for context expansion and quotes at the displayed PR revisions. */
export function useReviewContents({
  detail,
  rpc,
  threadId,
  url,
  setNotice,
  setError,
}: {
  detail: LinkedDetail | null;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  threadId: string | null;
  url: string;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
}) {
  const [loadedContentsRevision, setLoadedContentsRevision] = useState(0);
  // A refreshed detail starts a new cache. The revision tells the viewer when this map changes.
  const fullDiffs = useMemo(() => {
    if (!detail) return new Map<string, FileDiffMetadata>();
    let cached = contentsCache.get(detail);
    if (!cached) {
      cached = new Map<string, FileDiffMetadata>();
      contentsCache.set(detail, cached);
    }
    return cached;
  }, [detail]);
  const loadDiffFiles = useMemo<FileDiffContentsLoader>(() => {
    const pending = new Map<string, ReturnType<FileDiffContentsLoader>>();
    return (fileDiff) => {
      const cached = pending.get(fileDiff.name);
      if (cached) return cached;
      const request = (async () => {
        if (!detail?.baseRefOid || !detail.headRefOid)
          throw new Error("Refresh this PR before expanding context.");
        setNotice("Loading unchanged lines…");
        setError("");
        const input = {
          url,
          path: fileDiff.name,
          oldPath: fileDiff.prevName ?? fileDiff.name,
          base: detail.baseRefOid,
          head: detail.headRefOid,
          changeType: fileDiff.type,
        };
        const contents = threadId
          ? await rpc.call("linkedContents", { ...input, threadId })
          : await rpc.call("reviewDraftContents", input);
        const key = `${url}:${detail.baseRefOid}:${detail.headRefOid}`;
        const oldFile = {
          name: fileDiff.prevName ?? fileDiff.name,
          contents: contents.oldContents,
          cacheKey: `${key}:old:${fileDiff.name}`,
        };
        const newFile = {
          name: fileDiff.name,
          contents: contents.newContents,
          cacheKey: `${key}:new:${fileDiff.name}`,
        };
        fullDiffs.set(fileDiff.name, parseDiffFromFile(oldFile, newFile));
        setLoadedContentsRevision((value) => value + 1);
        setNotice("");
        return { oldFile, newFile };
      })().catch((error) => {
        pending.delete(fileDiff.name);
        setNotice("");
        setError(`Could not expand context: ${String(error)}. Refresh the PR to retry.`);
        throw error;
      });
      pending.set(fileDiff.name, request);
      return request;
    };
  }, [detail, rpc, threadId, url, fullDiffs, setNotice, setError]);

  return { fullDiffs, loadedContentsRevision, loadDiffFiles };
}
