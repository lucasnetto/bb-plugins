import { Button } from "../components/ui/button";
import type { useReviewDiff } from "./useReviewDiff";

export function ReviewToolbar({
  fileCount,
  guideOpen,
  onToggleGuide,
  treeOpen,
  onToggleTree,
  loading,
  refresh,
  diff,
}: {
  fileCount: number;
  guideOpen: boolean;
  onToggleGuide: () => void;
  treeOpen: boolean;
  onToggleTree: () => void;
  loading: boolean;
  refresh: () => void;
  diff: Pick<
    ReturnType<typeof useReviewDiff>,
    | "style"
    | "setStyle"
    | "wrap"
    | "setWrap"
    | "expandContext"
    | "collapseContext"
    | "toggleAllFiles"
    | "collapsed"
    | "parsed"
  >;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
      <span className="mr-auto px-2 text-xs font-medium">
        Code <span className="text-muted-foreground">{fileCount}</span>
      </span>
      <Button
        size="sm"
        variant={guideOpen ? "secondary" : "ghost"}
        aria-pressed={guideOpen}
        onClick={onToggleGuide}
      >
        Guide
      </Button>
      <Button
        size="sm"
        variant={diff.style === "unified" ? "secondary" : "ghost"}
        aria-pressed={diff.style === "unified"}
        onClick={() => diff.setStyle("unified")}
      >
        Unified
      </Button>
      <Button
        size="sm"
        variant={diff.style === "split" ? "secondary" : "ghost"}
        aria-pressed={diff.style === "split"}
        onClick={() => diff.setStyle("split")}
      >
        Split
      </Button>
      <Button
        size="sm"
        variant={diff.wrap ? "secondary" : "ghost"}
        aria-pressed={diff.wrap}
        onClick={() => diff.setWrap(!diff.wrap)}
      >
        Wrap
      </Button>
      <Button
        size="sm"
        variant={treeOpen ? "secondary" : "ghost"}
        aria-pressed={treeOpen}
        onClick={onToggleTree}
      >
        Files
      </Button>
      <Button size="sm" variant="ghost" disabled={loading} onClick={refresh}>
        Refresh
      </Button>
      <Button size="sm" variant="ghost" disabled={loading} onClick={diff.expandContext}>
        Expand context
      </Button>
      <Button size="sm" variant="ghost" onClick={diff.collapseContext}>
        Collapse context
      </Button>
      <Button size="sm" variant="ghost" onClick={diff.toggleAllFiles}>
        {diff.parsed.length && diff.collapsed.size === diff.parsed.length
          ? "Expand all"
          : "Collapse all"}
      </Button>
    </div>
  );
}
