import { useState } from "react";
import { useRpc, useComposer } from "@get-bb/plugin-sdk/app";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { rpcContract } from "../../shared/contract";
import type { LinkedDetail } from "../../shared/links-contract";
import type { ReviewSelection } from "./useReviewDiff";
import { reviewContext } from "./selection";

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
  threadId: string;
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
  async function add(action: "Ask" | "Explain" | "Fix" | "Comment") {
    if (!detail || addingComment) return;
    setAddingComment(true);
    try {
      const prompt = reviewContext(
        detail,
        selectionPath ?? selectedPath,
        selection?.range,
        fullDiffs.get(selectionPath ?? selectedPath ?? ""),
      );
      const path = selectionPath ?? selectedPath;
      const label = path
        ? `${path.split("/").pop()}${selection ? ` · ${selection.range.start}–${selection.range.end}` : ""}`
        : `${detail.pr.repository} #${detail.pr.number}`;
      const { id } = await rpc.call("stageReviewComment", {
        threadId,
        url,
        label,
        context: prompt,
      });
      const text =
        action === "Comment"
          ? comment.trim()
          : `${action === "Ask" ? "Review" : action} ${selection ? "this code" : path ? "this file" : "this PR"}.${comment.trim() ? `\n${comment.trim()}` : ""}`;
      composer.updateText((current) => (current ? `${current}\n\n${text} ` : `${text} `));
      composer.insertMention({ provider: "review-comment", id, label });
      composer.focus();
      setComment("");
      setNotice("Added to your draft.");
    } catch (error) {
      setError(String(error));
    } finally {
      setAddingComment(false);
    }
  }
  return { comment, setComment, addingComment, add };
}
