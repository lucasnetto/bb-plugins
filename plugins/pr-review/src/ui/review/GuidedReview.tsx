// Chapter-card layout adapted from Plannotator. See ../../PLANNOTATOR-LICENSE.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CodeViewDiffItem } from "@pierre/diffs";
import type { CodeViewProps } from "@pierre/diffs/react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { guideChapters, type SavedGuide } from "../../shared/guide-contract";
import { StyledDiffCodeView, type StyledDiffCodeViewOptions } from "./StyledDiffCodeView";
import { Button } from "../components/ui/button";

type Selection = CodeViewProps<undefined, undefined>["selectedLines"];
type DiffProps = {
  annotation?: CodeViewProps<undefined, undefined>["renderAnnotation"];
  options: StyledDiffCodeViewOptions<undefined>;
  selection: Selection;
  onSelection: (selection: Selection) => void;
  header: (item: CodeViewDiffItem | { id: string; type: "file" }) => ReactNode;
};
type Chapter = ReturnType<typeof guideChapters>[number];

function GuideFile({
  item,
  path,
  summary,
  stale,
  selected,
  register,
  onActivate,
  ...diff
}: DiffProps & {
  item?: CodeViewDiffItem;
  path: string;
  summary: string;
  stale: boolean;
  selected: boolean;
  register: (element: HTMLDivElement | null) => void;
  onActivate: () => void;
}) {
  const shell = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!shell.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: "600px 0px",
    });
    observer.observe(shell.current);
    return () => observer.disconnect();
  }, []);
  const items = useMemo(() => (item ? [item] : []), [item]);
  const height = item?.collapsed ? 40 : 520;
  return (
    <div
      ref={(element) => {
        shell.current = element;
        register(element);
      }}
      className="scroll-mt-4"
      onFocusCapture={onActivate}
    >
      {!stale && item ? (
        <>
          <Markdown className="mb-2 px-1 text-xs text-muted-foreground" content={summary} />
          <div
            className="overflow-hidden rounded-lg border border-border/50 bg-background"
            style={{ height }}
          >
            {near || selected ? (
              <StyledDiffCodeView
                className="h-full overflow-auto"
                items={items}
                options={diff.options}
                selectedLines={diff.selection?.id === item.id ? diff.selection : null}
                onSelectedLinesChange={diff.onSelection}
                renderHeaderPrefix={diff.header}
                renderAnnotation={diff.annotation}
              />
            ) : (
              <div className="truncate border-b border-border/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                {path}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-3 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 break-all font-mono">{path}</span>
          <span>
            {stale ? "Earlier revision · regenerate to view code" : "No readable patch available"}
          </span>
        </div>
      )}
    </div>
  );
}

function ChapterCard({
  chapter,
  index,
  total,
  reviewed,
  pending,
  stale,
  byPath,
  selectedPath,
  onSelectPath,
  onMark,
  ...diff
}: DiffProps & {
  chapter: Chapter;
  index: number;
  total: number;
  reviewed: boolean;
  pending: boolean;
  stale: boolean;
  byPath: Map<string, CodeViewDiffItem>;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onMark: (reviewed: boolean) => void;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const files = useRef(new Map<string, HTMLDivElement>());
  const collapsed = override ?? reviewed;
  const position = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const checkbox = (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <input
        aria-label={`Reviewed: ${chapter.title}`}
        type="checkbox"
        checked={reviewed}
        disabled={pending || stale}
        onChange={(event) => {
          setOverride(null);
          onMark(event.target.checked);
        }}
      />
      Reviewed
    </label>
  );
  return (
    <article
      aria-label={chapter.title}
      className="overflow-clip rounded-lg border border-border/50 bg-card"
    >
      {collapsed ? (
        <div className="flex items-center gap-3 px-5 py-4">
          {checkbox}
          <button
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-label={`Expand chapter: ${chapter.title}`}
            onClick={() => setOverride(false)}
          >
            <h3 className="min-w-0 flex-1 text-sm font-semibold">{chapter.title}</h3>
            <span className="text-xs text-muted-foreground">{chapter.diffs.length} files</span>
            <span className="font-mono text-xs text-muted-foreground">{position}</span>
            <span aria-hidden="true">▸</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 @min-[760px]:grid-cols-[minmax(240px,26%)_minmax(0,1fr)]">
          <div className="border-b border-border/40 @min-[760px]:border-r @min-[760px]:border-b-0">
            <div className="px-5 py-5 @min-[760px]:sticky @min-[760px]:top-0">
              <div className="flex items-start gap-2">
                <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug">
                  {chapter.title}
                </h3>
                <button
                  className="px-1 text-muted-foreground"
                  aria-label={`Collapse chapter: ${chapter.title}`}
                  onClick={() => setOverride(true)}
                >
                  ▴
                </button>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{position}</span>
                {checkbox}
              </div>
              <Markdown
                className="mt-4 text-sm leading-relaxed text-muted-foreground"
                content={chapter.overview}
              />
              <div className="mt-5 space-y-2">
                {chapter.diffs.map((file) => {
                  const slash = file.file.lastIndexOf("/");
                  return (
                    <button
                      key={file.file}
                      title={`${file.file}\n\n${file.summary}`}
                      className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-2 text-left font-mono text-[11px] ${selectedPath === file.file ? "border-primary/50 bg-primary/10" : "border-border/40 bg-background"}`}
                      onClick={() => {
                        onSelectPath(file.file);
                        files.current.get(file.file)?.scrollIntoView({ block: "start" });
                      }}
                    >
                      <span className="shrink-0">{file.file.slice(slash + 1)}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {slash < 0 ? "" : file.file.slice(0, slash)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="min-w-0 space-y-4 bg-muted/10 p-3 @min-[760px]:p-4">
            {chapter.diffs.map((file) => (
              <GuideFile
                key={file.file}
                {...diff}
                path={file.file}
                summary={file.summary}
                item={byPath.get(file.file)}
                stale={stale}
                selected={selectedPath === file.file}
                onActivate={() => onSelectPath(file.file)}
                register={(element) => {
                  if (element) files.current.set(file.file, element);
                  else files.current.delete(file.file);
                }}
              />
            ))}
            {!chapter.diffs.length ? (
              <p className="p-6 text-sm text-muted-foreground">
                Context chapter. No changed files.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}

export function GuidedReview({
  saved,
  items,
  stale,
  pending,
  onRequest,
  onMark,
  selectedPath,
  onSelectPath,
  ...diff
}: DiffProps & {
  saved: SavedGuide;
  items: CodeViewDiffItem[];
  stale: boolean;
  pending: boolean;
  onRequest: () => void;
  onMark: (index: number, reviewed: boolean) => void;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
}) {
  const chapters = useMemo(() => guideChapters(saved.guide), [saved.guide]);
  const byPath = useMemo(() => new Map(items.map((item) => [item.fileDiff.name, item])), [items]);
  return (
    <div
      aria-label="Guided review chapters"
      className="@container min-h-0 flex-1 overflow-auto p-4 [scrollbar-gutter:stable]"
    >
      <header className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">{saved.guide.title}</h2>
        <Markdown
          className="mt-2 max-w-3xl text-sm text-muted-foreground"
          content={saved.guide.intent}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{chapters.length} chapters</span>
          <span className="rounded border border-border px-1.5 py-0.5">Saved</span>
          <span role="status">
            {saved.reviewed.filter(Boolean).length} / {chapters.length} reviewed
          </span>
          <Button size="sm" variant="ghost" disabled={pending} onClick={onRequest}>
            Regenerate
          </Button>
        </div>
        {stale ? (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Generated on an earlier revision of this PR. Regenerate to review the current code.
          </p>
        ) : null}
      </header>
      <div className="space-y-4">
        {chapters.map((chapter, index) => (
          <ChapterCard
            key={`${saved.id}:${index}`}
            {...diff}
            chapter={chapter}
            index={index}
            total={chapters.length}
            reviewed={saved.reviewed[index] ?? false}
            pending={pending}
            stale={stale}
            byPath={byPath}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            onMark={(reviewed) => onMark(index, reviewed)}
          />
        ))}
      </div>
    </div>
  );
}
