import { Match } from "effect";
import type { GithubComment } from "../../shared/github-review-contract";
import {
  useCallback,
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
import { useMediaQuery } from "../components/ui/hooks/use-media-query";
import { GithubReviewThread, groupReviewComments } from "./GithubReviewThread";
import type { GithubReview } from "./GithubReviewPanel";

export type ReviewSelection = NonNullable<CodeViewProps<undefined, undefined>["selectedLines"]>;

export type ReviewAnnotationRenderer = NonNullable<
  CodeViewProps<undefined, undefined>["renderAnnotation"]
>;

export function useReviewDiff({
  comments = [],
  review,
  detail,
  threadId,
  url,
  revision,
  setSelectedPath,
  setError,
  setNotice,
}: {
  comments?: GithubComment[];
  review?: GithubReview;
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
  const touchSelection = useMediaQuery("(pointer: coarse)");
  const [style, setStyle] = useState<"split" | "unified">("unified");
  const [expandUnchanged, setExpandUnchanged] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const [wrap, setWrap] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [selectedLines, setSelectedLines] = useState<{
    revision: number;
    lines: ReviewSelection;
  } | null>(null);

  const [selectingRevision, setSelectingRevision] = useState<number | null>(null);
  // PR identity is scoped by PullRequestDetail's key. Only line interaction
  // belongs to a revision; display preferences and the viewer survive refreshes.
  const selection = selectedLines?.revision === revision ? selectedLines.lines : null;
  const selecting = selectingRevision === revision;
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);

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

  const annotationSignature = JSON.stringify([
    comments,
    selectionAnchor,
    review?.state?.login,
    review?.state?.pending,
    review?.busy,
    review?.synced,
  ]);

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
        status: Match.value(file.status).pipe(
          Match.when("added", () => "added" as const),
          Match.when("removed", () => "deleted" as const),
          Match.when("renamed", () => "renamed" as const),
          Match.orElse(() => "modified" as const),
        ),
      })) ?? [],
    [detail],
  );

  const options = useMemo<StyledDiffCodeViewOptions<undefined>>(
    () => ({
      theme: mode === "dark" ? "pierre-dark" : "pierre-light",
      themeType: mode,
      diffStyle: style,
      overflow: wrap ? "wrap" : "scroll",
      diffIndicators: "classic",
      enableLineSelection: !touchSelection,
      onLineNumberClick: touchSelection
        ? (line, item) => {
            setSelectedLines({
              revision,
              lines: {
                id: item.item.id,
                range: {
                  start: line.lineNumber,
                  end: line.lineNumber,
                  side: line.type === "diff-line" ? line.annotationSide : undefined,
                },
              },
            });
            setSelectingRevision(null);

            if (item.type === "diff") setSelectedPath(item.item.fileDiff.name);
            setNotice("");
          }
        : undefined,
      onLineSelectionStart: () => setSelectingRevision(revision),
      onLineSelectionEnd: () => setSelectingRevision(null),
      lineHoverHighlight: "both",
      hunkSeparators: "line-info",
      expandUnchanged,
    }),
    [mode, style, wrap, expandUnchanged, revision, touchSelection, setSelectedPath, setNotice],
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
        {groupReviewComments(matching).map((comments) =>
          review ? (
            <GithubReviewThread key={comments[0].threadId} comments={comments} review={review} />
          ) : null,
        )}
      </div>
    );
  };

  const selectionPath = selection
    ? (items.find((item) => item.id === selection.id)?.fileDiff.name ?? null)
    : null;

  const allFilesCollapsed = parsed.length > 0 && collapsed.size === parsed.length;

  const clearSelection = useCallback(() => {
    setSelectedLines(null);
    setSelectingRevision(null);
  }, []);

  function selectLines(next: ReviewSelection | null | undefined) {
    setSelectedLines(next ? { revision, lines: next } : null);

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
    setSelectedLines(null);
  }

  function expandContext() {
    setExpandUnchanged(true);
    setCollapsed(new Set());
    setSelectedLines(null);
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
