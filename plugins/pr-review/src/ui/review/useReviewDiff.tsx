import type { GithubComment } from "../../shared/github-review-contract";
import { Markdown } from "@get-bb/plugin-sdk/app";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { type CodeViewDiffItem } from "@pierre/diffs";
import type { CodeViewHandle, CodeViewProps } from "@pierre/diffs/react";
import { useRpc, experimental_useCodeTheme } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import type { LinkedDetail } from "../../shared/links-contract";
import type { StyledDiffCodeViewOptions } from "./StyledDiffCodeView";
import { useReviewContents } from "./useReviewContents";
import { parseReviewFile, ContextHeader, diffRecordVersion } from "./diff-adapter";
import { selectedFileEnd } from "./expandedSelection";

export type ReviewSelection = NonNullable<CodeViewProps<undefined, undefined>["selectedLines"]>;
export type ReviewAnnotationRenderer = NonNullable<
  CodeViewProps<undefined, undefined>["renderAnnotation"]
>;
export function useReviewDiff({
  comments = [],
  pendingReviewId,
  onOpenReview,
  detail,
  threadId,
  url,
  revision,
  setSelectedPath,
  setError,
  setNotice,
}: {
  comments?: GithubComment[];
  pendingReviewId?: number;
  onOpenReview?: () => void;
  detail: LinkedDetail | null;
  threadId: string | null;
  url: string;
  revision: number;
  setSelectedPath: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const { mode } = experimental_useCodeTheme();
  const [style, setStyle] = useState<"split" | "unified">("unified");
  const [expandUnchanged, setExpandUnchanged] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const [wrap, setWrap] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [selecting, setSelecting] = useState(false);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  useEffect(() => {
    setSelection(null);
    setSelecting(false);
    setNotice("");
  }, [rpc, threadId, url, revision, setNotice]);
  const { fullDiffs, loadedContentsRevision, loadDiffFiles } = useReviewContents({
    detail,
    rpc,
    threadId,
    url,
    setNotice,
    setError,
  });
  const parsed = useMemo(
    () =>
      detail?.files
        .map(parseReviewFile)
        .filter((item): item is CodeViewDiffItem => item !== null) ?? [],
    [detail],
  );
  const selectionAnchor = useMemo(() => {
    if (!selection || selecting) return null;
    const item = parsed.find((item) => `${contextRevision}:${item.id}` === selection.id);
    if (!item) return null;
    const anchor = selectedFileEnd(fullDiffs.get(item.id) ?? item.fileDiff, selection.range);
    return anchor ? { ...anchor, id: selection.id } : null;
  }, [selection, selecting, parsed, contextRevision, fullDiffs, loadedContentsRevision]);
  const annotationSignature = JSON.stringify([comments, selectionAnchor]);
  const annotationVersion = useRef({ signature: "", version: 0 });
  if (annotationVersion.current.signature !== annotationSignature) {
    annotationVersion.current = {
      signature: annotationSignature,
      version: annotationVersion.current.version + 1,
    };
  }
  const commentsVersion = annotationVersion.current.version;
  // Pierre reconciles existing records only when their version changes, including collapse state.
  const items = useMemo(
    () =>
      parsed.map((item) => ({
        ...item,
        id: `${contextRevision}:${item.id}`,
        fileDiff: fullDiffs.get(item.id) ?? item.fileDiff,
        version:
          diffRecordVersion(revision, fullDiffs.has(item.id), collapsed.has(item.id)) +
          commentsVersion * 1000000,
        annotations: [
          ...new Map(
            [
              ...comments
                .filter(
                  (c) =>
                    c.path === item.fileDiff.name &&
                    !c.outdated &&
                    (c.line !== null || c.subjectType === "FILE"),
                )
                .map((c) => {
                  const annotation = {
                    side: c.side === "LEFT" ? ("deletions" as const) : ("additions" as const),
                    lineNumber: c.line ?? 0,
                  };
                  return annotation;
                }),
              ...(selectionAnchor?.id === `${contextRevision}:${item.id}` ? [selectionAnchor] : []),
            ].map(
              (annotation) => [`${annotation.side}:${annotation.lineNumber}`, annotation] as const,
            ),
          ).values(),
        ],
        collapsed: collapsed.has(item.id),
      })),
    [
      parsed,
      collapsed,
      fullDiffs,
      loadedContentsRevision,
      revision,
      contextRevision,
      comments,
      commentsVersion,
      selectionAnchor,
    ],
  );
  const entries = useMemo(
    () =>
      detail?.files.map((file) => ({
        path: file.path,
        status:
          file.status === "added"
            ? ("added" as const)
            : file.status === "removed"
              ? ("deleted" as const)
              : file.status === "renamed"
                ? ("renamed" as const)
                : ("modified" as const),
      })) ?? [],
    [detail],
  );
  const options = useMemo<StyledDiffCodeViewOptions<undefined>>(
    () => ({
      theme: mode === "dark" ? "pierre-dark" : "pierre-light",
      themeType: mode,
      diffStyle: style,
      overflow: wrap ? "wrap" : "scroll",
      diffIndicators: "bars",
      enableLineSelection: true,
      onLineSelectionStart: () => setSelecting(true),
      onLineSelectionEnd: () => setSelecting(false),
      lineHoverHighlight: "both",
      hunkSeparators: "line-info",
      expandUnchanged,
    }),
    [mode, style, wrap, expandUnchanged],
  );
  const toggle = useCallback(
    (id: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const header = useCallback(
    (item: CodeViewDiffItem | { id: string; type: "file" }) => {
      const path = item.type === "diff" ? item.fileDiff.name : item.id;
      const button = (
        <button
          className="px-2 text-muted-foreground"
          aria-label={`${collapsed.has(path) ? "Expand" : "Collapse"} ${path}`}
          onClick={() => toggle(path)}
        >
          {collapsed.has(path) ? "▸" : "▾"}
        </button>
      );
      return item.type === "diff" ? (
        <ContextHeader item={item} load={loadDiffFiles}>
          {button}
        </ContextHeader>
      ) : (
        button
      );
    },
    [collapsed, toggle, loadDiffFiles],
  );
  const annotation = (
    anchor: Parameters<ReviewAnnotationRenderer>[0],
    item: Parameters<ReviewAnnotationRenderer>[1],
    selectionContent?: ReactNode,
  ) => {
    if (item.type !== "diff" || !("side" in anchor)) return null;
    const side = anchor.side === "deletions" ? "LEFT" : "RIGHT";
    const matching = comments.filter(
      (c) =>
        c.path === item.fileDiff.name && (c.line ?? 0) === anchor.lineNumber && c.side === side,
    );
    return (
      <div className="flex min-w-0 flex-col gap-2 px-3 py-2 font-sans text-sm whitespace-normal text-foreground [overflow-wrap:anywhere]">
        {selectionAnchor?.id === item.id &&
        selectionAnchor.side === anchor.side &&
        selectionAnchor.lineNumber === anchor.lineNumber
          ? selectionContent
          : null}
        {matching.map((comment) => (
          <div
            key={comment.id}
            className="min-w-0 rounded-md border border-border bg-background p-3"
          >
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {comment.user?.login} ·{" "}
                {comment.pull_request_review_id === pendingReviewId
                  ? "Pending · only you"
                  : "Published"}
              </span>
              <button className="underline" onClick={onOpenReview}>
                View review
              </button>
            </div>
            <Markdown className="min-w-0 max-w-full overflow-x-auto" content={comment.body} />
          </div>
        ))}
      </div>
    );
  };
  const selectionPath = selection
    ? (items.find((item) => item.id === selection.id)?.fileDiff.name ?? null)
    : null;
  const allFilesCollapsed = parsed.length > 0 && collapsed.size === parsed.length;
  const clearSelection = useCallback(() => {
    setSelection(null);
    setSelecting(false);
  }, []);
  function selectLines(next: ReviewSelection | null | undefined) {
    setSelection(next ?? null);
    if (next) setSelectedPath(items.find((item) => item.id === next.id)?.fileDiff.name ?? null);
    setNotice("");
  }
  function expandAllFiles() {
    setCollapsed(new Set());
  }
  function hasReadablePatch(path: string) {
    return parsed.some((item) => item.id === path);
  }
  function toggleAllFiles() {
    setCollapsed(
      collapsed.size === parsed.length ? new Set() : new Set(parsed.map((item) => item.id)),
    );
  }
  function collapseContext() {
    // Replace the file records through controlled props, preserving the root
    // virtualizer's dimensions, scroll observer, and worker subscriptions.
    setExpandUnchanged(false);
    setContextRevision((value) => value + 1);
    viewer.current?.scrollTo({ type: "position", position: 0 });
    setSelection(null);
  }
  function expandContext() {
    setExpandUnchanged(true);
    setCollapsed(new Set());
    setSelection(null);
  }
  function reveal(path: string) {
    setSelectedPath(path);
    clearSelection();
    setNotice("");
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(path);
      return next;
    });
    const item = items.find((item) => item.fileDiff.name === path);
    if (item) viewer.current?.scrollTo({ type: "item", id: item.id, align: "start" });
  }

  return {
    display: {
      style,
      setStyle,
      wrap,
      setWrap,
      allFilesCollapsed,
      toggleAllFiles,
      collapseContext,
      expandContext,
    },
    selection: { lines: selection, path: selectionPath, selectLines, clear: clearSelection },
    viewer: { ref: viewer, mode, items, options, header, annotation },
    files: { entries, fullDiffs, hasReadablePatch, reveal, expandAll: expandAllFiles },
  };
}
