// BB adapter for T3 Code's PR code tab. Ported components retain T3-LICENSE.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  parsePatchFiles,
  parseDiffFromFile,
  type FileDiffMetadata,
  type FileDiffContentsLoader,
  type CodeViewDiffItem,
} from "@pierre/diffs";
import type { CodeViewHandle, CodeViewProps } from "@pierre/diffs/react";
import { useRpc, useComposer, experimental_useCodeTheme, UrlLink } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { LinkedDetail } from "../links-contract";
import { Button } from "../components/ui/button";
import { StyledDiffCodeView, type StyledDiffCodeViewOptions } from "./StyledDiffCodeView";
import { DiffFileTree } from "./DiffFileTree";
import { reviewContext } from "./selection";

type Selection = NonNullable<CodeViewProps<undefined, undefined>["selectedLines"]>;
function parseFile(file: LinkedDetail["files"][number]): CodeViewDiffItem | null {
  if (!file.patch) return null;
  // JSON quoting is Git's path quoting convention, including spaces and tabs.
  const patch = `diff --git ${JSON.stringify(`a/${file.path}`)} ${JSON.stringify(`b/${file.path}`)}\n--- ${JSON.stringify(`a/${file.path}`)}\n+++ ${JSON.stringify(`b/${file.path}`)}\n${file.patch}\n`;
  try {
    const parsed = parsePatchFiles(patch)[0]?.files[0];
    if (!parsed) return null;
    parsed.name = file.path;
    if (file.previousPath) parsed.prevName = file.previousPath;
    parsed.type =
      file.status === "added"
        ? "new"
        : file.status === "removed"
          ? "deleted"
          : file.status === "renamed"
            ? "rename-changed"
            : "change";
    return { id: file.path, type: "diff", fileDiff: parsed };
  } catch {
    return null;
  }
}
// BB's bundled Pierre version expands full-file diffs but cannot hydrate a
// partial diff on click. Fetch only files whose virtualized header is mounted.
function ContextHeader({
  item,
  load,
  children,
}: {
  item: CodeViewDiffItem;
  load: FileDiffContentsLoader;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (item.fileDiff.isPartial) void load(item.fileDiff).catch(() => {});
  }, [item.fileDiff, load]);
  return children;
}
export function PrReview({ threadId, url }: { threadId: string; url: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const { mode } = experimental_useCodeTheme();
  const [detail, setDetail] = useState<LinkedDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [style, setStyle] = useState<"split" | "unified">("unified");
  const [expandUnchanged, setExpandUnchanged] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const [wrap, setWrap] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState("");
  const [comment, setComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    setSelection(null);
    setNotice("");
    rpc
      .call("linkedDetail", { threadId, url })
      .then(
        (value) => {
          if (disposed) return;
          setDetail(value);
          setSelectedPath((current) =>
            value.files.some((f) => f.path === current) ? current : (value.files[0]?.path ?? null),
          );
        },
        (error) => {
          if (!disposed) setError(String(error));
        },
      )
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [rpc, threadId, url, revision]);
  const [hydration, setHydration] = useState(0);
  const fullDiffs = useMemo(() => new Map<string, FileDiffMetadata>(), [detail]);
  const parsed = useMemo(
    () =>
      detail?.files.map(parseFile).filter((item): item is CodeViewDiffItem => item !== null) ?? [],
    [detail],
  );
  // Pierre reconciles existing records only when their version changes, including collapse state.
  const items = useMemo(
    () =>
      parsed.map((item) => ({
        ...item,
        id: `${contextRevision}:${item.id}`,
        fileDiff: fullDiffs.get(item.id) ?? item.fileDiff,
        version: revision * 4 + (fullDiffs.has(item.id) ? 2 : 0) + (collapsed.has(item.id) ? 1 : 0),
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
  }, [detail, rpc, threadId, url, fullDiffs]);
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
  const unavailable = selectedPath && !parsed.some((item) => item.id === selectedPath);
  return (
    <section
      aria-label="Pull request code review"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      style={
        {
          "--code-background": "var(--background)",
          "--code-foreground": "var(--foreground)",
          colorScheme: mode,
        } as CSSProperties
      }
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {detail?.pr.repository} #{detail?.pr.number}
          </span>
          <span>{detail?.pr.state.toLowerCase()}</span>
          <span className="ml-auto">
            <UrlLink href={url}>Open on GitHub ↗</UrlLink>
          </span>
        </div>
        <h2 className="mt-2 truncate text-sm font-semibold" title={detail?.pr.title}>
          {detail?.pr.title ?? "Loading pull request…"}
        </h2>
        {detail ? (
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {detail.baseRefName} ← {detail.headRefName}
          </p>
        ) : null}
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <span className="mr-auto px-2 text-xs font-medium">
          Code <span className="text-muted-foreground">{detail?.files.length ?? 0}</span>
        </span>
        <Button
          size="sm"
          variant={style === "unified" ? "secondary" : "ghost"}
          aria-pressed={style === "unified"}
          onClick={() => setStyle("unified")}
        >
          Unified
        </Button>
        <Button
          size="sm"
          variant={style === "split" ? "secondary" : "ghost"}
          aria-pressed={style === "split"}
          onClick={() => setStyle("split")}
        >
          Split
        </Button>
        <Button
          size="sm"
          variant={wrap ? "secondary" : "ghost"}
          aria-pressed={wrap}
          onClick={() => setWrap(!wrap)}
        >
          Wrap
        </Button>
        <Button
          size="sm"
          variant={treeOpen ? "secondary" : "ghost"}
          aria-pressed={treeOpen}
          onClick={() => setTreeOpen(!treeOpen)}
        >
          Files
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh
        </Button>
        <Button size="sm" variant="ghost" disabled={loading} onClick={expandContext}>
          Expand context
        </Button>
        <Button size="sm" variant="ghost" onClick={collapseContext}>
          Collapse context
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setCollapsed(
              collapsed.size === parsed.length ? new Set() : new Set(parsed.map((item) => item.id)),
            )
          }
        >
          {parsed.length && collapsed.size === parsed.length ? "Expand all" : "Collapse all"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading diff…
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 min-w-0 flex-1">
          {unavailable ? (
            <div className="p-4 text-sm">
              <p className="mb-2 break-all">{selectedPath}</p>
              <p className="text-muted-foreground">
                GitHub did not provide a readable patch for this file.
              </p>
              <UrlLink href={`${url}/files`}>Open file on GitHub ↗</UrlLink>
            </div>
          ) : (
            <StyledDiffCodeView
              viewerRef={viewer}
              className="h-full overflow-auto [scrollbar-gutter:stable]"
              items={items}
              options={options}
              selectedLines={selection}
              onSelectedLinesChange={(next) => {
                setSelection(next);
                if (next)
                  setSelectedPath(items.find((item) => item.id === next.id)?.fileDiff.name ?? null);
                setNotice("");
              }}
              renderHeaderPrefix={header}
            />
          )}
          {!loading && detail?.files.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No changed files.</p>
          ) : null}
        </div>
        {treeOpen ? (
          <aside className="flex min-h-0 w-[35%] min-w-36 max-w-72 shrink-0 border-l border-border">
            <DiffFileTree
              entries={entries}
              onSelectFile={reveal}
              selectedPath={selectedPath}
              ariaLabel="Changed files"
            />
          </aside>
        ) : null}
      </div>
      {selection || comment ? (
        <form
          className="shrink-0 space-y-2 border-t border-border px-3 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (selection && comment.trim() && !loading && !addingComment) void add("Comment");
          }}
        >
          <label
            className="block text-xs font-medium"
            htmlFor={`review-comment-${threadId}-${detail?.pr.number}`}
          >
            Comment on selected code
          </label>
          <textarea
            id={`review-comment-${threadId}-${detail?.pr.number}`}
            rows={3}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="What should the agent check or change?"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.metaKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {selection
                ? "Adds your comment and selected code to this chat."
                : "Select lines to attach this comment."}
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={loading || addingComment || !detail || !selection || !comment.trim()}
            >
              Add to chat ⌘↵
            </Button>
          </div>
        </form>
      ) : null}
      <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-3 py-2">
        <span
          className="mr-auto min-w-0 truncate text-xs text-muted-foreground"
          title={selectedPath ?? undefined}
        >
          {selection
            ? `${selectionPath} · ${selection.range.start}–${selection.range.end}`
            : (selectedPath ?? "Select a file or lines")}
        </span>
        {(["Ask", "Explain", "Fix"] as const).map((action) => (
          <Button
            key={action}
            size="sm"
            variant="ghost"
            disabled={loading || addingComment || !detail}
            onClick={() => add(action)}
          >
            {action}
          </Button>
        ))}
        {selection ? (
          <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>
            Clear selection
          </Button>
        ) : null}
        {notice ? (
          <span role="status" className="w-full text-xs text-muted-foreground">
            {notice}
          </span>
        ) : null}
      </footer>
    </section>
  );
}
