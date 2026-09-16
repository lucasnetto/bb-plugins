import { Button } from "../components/ui/button";
import type { useReviewDiff } from "./useReviewDiff";

export function ReviewToolbar({
  fileCount,
  guideOpen,
  onToggleGuide,
  treeOpen,
  onToggleTree,
  loading,
  display,
}: {
  fileCount: number;
  guideOpen: boolean;
  onToggleGuide?: () => void;
  treeOpen: boolean;
  onToggleTree: () => void;
  loading: boolean;
  display: ReturnType<typeof useReviewDiff>["display"];
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
      <span className="mr-auto px-2 text-xs font-medium">
        Code <span className="text-muted-foreground">{fileCount}</span>
      </span>
      {onToggleGuide ? (
        <Button
          size="sm"
          variant={guideOpen ? "secondary" : "ghost"}
          aria-pressed={guideOpen}
          onClick={onToggleGuide}
        >
          Guide
        </Button>
      ) : null}
      <Button
        size="sm"
        variant={display.style === "unified" ? "secondary" : "ghost"}
        aria-pressed={display.style === "unified"}
        onClick={() => display.setStyle("unified")}
      >
        Unified
      </Button>
      <Button
        size="sm"
        variant={display.style === "split" ? "secondary" : "ghost"}
        aria-pressed={display.style === "split"}
        onClick={() => display.setStyle("split")}
      >
        Split
      </Button>
      <Button
        size="sm"
        variant={display.wrap ? "secondary" : "ghost"}
        aria-pressed={display.wrap}
        onClick={() => display.setWrap(!display.wrap)}
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
      <Button size="sm" variant="ghost" disabled={loading} onClick={display.expandContext}>
        Expand context
      </Button>
      <Button size="sm" variant="ghost" onClick={display.collapseContext}>
        Collapse context
      </Button>
      <Button size="sm" variant="ghost" onClick={display.toggleAllFiles}>
        {display.allFilesCollapsed ? "Expand all" : "Collapse all"}
      </Button>
    </div>
  );
}
