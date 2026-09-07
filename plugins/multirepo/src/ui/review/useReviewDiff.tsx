import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  parseDiffFromFile,
  type FileDiffMetadata,
  type FileDiffContentsLoader,
  type CodeViewDiffItem,
} from "@pierre/diffs";
import type { CodeViewHandle, CodeViewProps } from "@pierre/diffs/react";
import { useRpc, experimental_useCodeTheme } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../shared/contract";
import type { LinkedDetail } from "../../shared/links-contract";
import type { StyledDiffCodeViewOptions } from "./StyledDiffCodeView";
import { parseReviewFile, ContextHeader, diffRecordVersion } from "./diff-adapter";

export type ReviewSelection = NonNullable<CodeViewProps<undefined, undefined>["selectedLines"]>;
export function useReviewDiff({
  detail,
  threadId,
  url,
  revision,
  setSelectedPath,
  setError,
  setNotice,
}: {
  detail: LinkedDetail | null;
  threadId: string;
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
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  useEffect(() => {
    setSelection(null);
    setNotice("");
  }, [rpc, threadId, url, revision, setNotice]);
  const [hydration, setHydration] = useState(0);
  const fullDiffs = useMemo(() => new Map<string, FileDiffMetadata>(), [detail]);
  const parsed = useMemo(
    () =>
      detail?.files
        .map(parseReviewFile)
        .filter((item): item is CodeViewDiffItem => item !== null) ?? [],
    [detail],
  );
  // Pierre reconciles existing records only when their version changes, including collapse state.
  const items = useMemo(
    () =>
      parsed.map((item) => ({
        ...item,
        id: `${contextRevision}:${item.id}`,
        fileDiff: fullDiffs.get(item.id) ?? item.fileDiff,
        version: diffRecordVersion(revision, fullDiffs.has(item.id), collapsed.has(item.id)),
        collapsed: collapsed.has(item.id),
      })),
    [parsed, collapsed, fullDiffs, hydration, revision, contextRevision],
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
        const contents = await rpc.call("linkedContents", {
          threadId,
          url,
          path: fileDiff.name,
          oldPath: fileDiff.prevName ?? fileDiff.name,
          base: detail.baseRefOid,
          head: detail.headRefOid,
          changeType: fileDiff.type,
        });
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
        setHydration((value) => value + 1);
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
  const options = useMemo<StyledDiffCodeViewOptions<undefined>>(
    () => ({
      theme: mode === "dark" ? "pierre-dark" : "pierre-light",
      themeType: mode,
      diffStyle: style,
      overflow: wrap ? "wrap" : "scroll",
      diffIndicators: "bars",
      enableLineSelection: true,
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
  const selectionPath = selection
    ? (items.find((item) => item.id === selection.id)?.fileDiff.name ?? null)
    : null;
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
    setSelection(null);
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
    mode,
    style,
    setStyle,
    wrap,
    setWrap,
    collapsed,
    setCollapsed,
    selection,
    setSelection,
    viewer,
    parsed,
    items,
    entries,
    fullDiffs,
    options,
    header,
    selectionPath,
    collapseContext,
    expandContext,
    reveal,
  };
}
