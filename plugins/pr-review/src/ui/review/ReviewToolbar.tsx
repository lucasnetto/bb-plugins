import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
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
  display: Pick<
    ReturnType<typeof useReviewDiff>["display"],
    "style" | "setStyle" | "wrap" | "setWrap"
  > &
    Partial<
      Pick<
        ReturnType<typeof useReviewDiff>["display"],
        "expandContext" | "collapseContext" | "toggleAllFiles" | "allFilesCollapsed"
      >
    >;
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
      <span title="Unified">
        <Button
          size="sm"
          className="w-8 px-0"
          aria-label="Unified"
          variant={display.style === "unified" ? "secondary" : "ghost"}
          aria-pressed={display.style === "unified"}
          onClick={() => display.setStyle("unified")}
        >
          <Icon name="Rows2" aria-hidden="true" />
        </Button>
      </span>
      <span title="Split">
        <Button
          size="sm"
          className="w-8 px-0"
          aria-label="Split"
          variant={display.style === "split" ? "secondary" : "ghost"}
          aria-pressed={display.style === "split"}
          onClick={() => display.setStyle("split")}
        >
          <Icon name="Columns2" aria-hidden="true" />
        </Button>
      </span>
      <span title="Wrap">
        <Button
          size="sm"
          className="w-8 px-0"
          aria-label="Wrap"
          variant={display.wrap ? "secondary" : "ghost"}
          aria-pressed={display.wrap}
          onClick={() => display.setWrap(!display.wrap)}
        >
          <Icon name="TextWrap" aria-hidden="true" />
        </Button>
      </span>
      <Button
        size="sm"
        variant={treeOpen ? "secondary" : "ghost"}
        aria-pressed={treeOpen}
        onClick={onToggleTree}
      >
        Files
      </Button>
      {display.expandContext ? (
        <Button size="sm" variant="ghost" disabled={loading} onClick={display.expandContext}>
          Expand context
        </Button>
      ) : null}
      {display.collapseContext ? (
        <Button size="sm" variant="ghost" onClick={display.collapseContext}>
          Collapse context
        </Button>
      ) : null}
      {display.toggleAllFiles ? (
        <Button size="sm" variant="ghost" onClick={display.toggleAllFiles}>
          {display.allFilesCollapsed ? "Expand all" : "Collapse all"}
        </Button>
      ) : null}
    </div>
  );
}
