import { useState } from "react";
import { useRpc, useComposer } from "@get-bb/plugin-sdk/app";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { rpcContract } from "../../shared/contract";
import type { LinkedDetail } from "../../shared/links-contract";
import type { ReviewSelection } from "./useReviewDiff";
import { reviewContext } from "./selection";
import { buildReviewDraftText, type ReviewAction } from "./reviewDraftText";

export function useReviewComposer({
  threadId,
  url,
  detail,
  selectedPath,
  selection,
  selectionPath,
  fullDiffs,
  setNotice,
  setError,
}: {
  threadId: string | null;
  url: string;
  detail: LinkedDetail | null;
  selectedPath: string | null;
  selection: ReviewSelection | null;
  selectionPath: string | null;
  fullDiffs: ReadonlyMap<string, FileDiffMetadata>;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const [comment, setComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);

  async function add(action: ReviewAction) {
    if (!threadId || !detail || addingComment) return false;
    setAddingComment(true);

    try {
      const targetPath = selectionPath ?? selectedPath;

      const prompt = reviewContext(
        detail,
        targetPath,
        selection?.range,
        fullDiffs.get(targetPath ?? ""),
      );

      const lineLabel = selection ? ` · ${selection.range.start}–${selection.range.end}` : "";

      const targetLabel = targetPath
        ? `${targetPath.split("/").pop()}${lineLabel}`
        : `${detail.pr.repository} #${detail.pr.number}`;

      const target = selection ? "this code" : targetPath ? "this file" : "this PR";
      const text = buildReviewDraftText(action, target, comment);

      if (threadId) {
        const { id } = await rpc.call("stageReviewComment", {
          threadId,
          url,
          label: targetLabel,
          context: prompt,
        });

        composer.updateText((current) => (current ? `${current}\n\n${text} ` : `${text} `));
        composer.insertMention({ provider: "review-comment", id, label: targetLabel });
        composer.focus();
      }

      setComment("");
      setNotice("Added to your draft.");
      return true;
    } catch (error) {
      setError(String(error));
      return false;
    } finally {
      setAddingComment(false);
    }
  }

  return { comment, setComment, addingComment, add };
}
