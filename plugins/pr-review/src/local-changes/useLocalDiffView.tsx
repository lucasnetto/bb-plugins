import { useMemo, useRef, useState } from "react";
import { parsePatchFiles, type CodeViewItem } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { experimental_useCodeTheme } from "@get-bb/plugin-sdk/app";
import type { Checkout, CheckoutDiff } from "./contract";
import type { StyledDiffCodeViewOptions } from "../ui/review/StyledDiffCodeView";

export const localFileId = (checkout: string, path: string) => JSON.stringify([checkout, path]);

export function useLocalDiffView(
  checkouts: Checkout[],
  previews: ReadonlyMap<string, CheckoutDiff>,
) {
  const { mode } = experimental_useCodeTheme();
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [style, setStyle] = useState<"unified" | "split">("unified");
  const [wrap, setWrap] = useState(false);
  const [selection, setSelection] = useState<{ checkout: string; path: string } | null>(null);

  const files = useMemo(
    () =>
      checkouts.flatMap((checkout) => {
        const loaded = new Map(previews.get(checkout.path)?.map((file) => [file.path, file]));

        return checkout.changes.map((change) => ({
          id: localFileId(checkout.path, change.path),
          checkout: checkout.path,
          label: `${checkout.repository} · ${checkout.branch}`,
          path: change.path,
          result: loaded.get(change.path),
        }));
      }),
    [checkouts, previews],
  );

  type LocalItem = CodeViewItem<undefined> & { ownerId: string };

  const cache = useRef(
    new Map<string, { patch: string; notice: string; revision: number; items: LocalItem[] }>(),
  );

  const parsed = useMemo(() => {
    const all: LocalItem[] = [];
    const live = new Set(files.map((file) => file.id));

    for (const id of cache.current.keys()) if (!live.has(id)) cache.current.delete(id);

    for (const file of files) {
      const patch = file.result?.patch ?? "";

      const notice = file.result
        ? (file.result.notice ?? "No text diff is available for this change.")
        : "Loading diff…";

      const previous = cache.current.get(file.id);

      if (previous && previous.patch === patch && previous.notice === notice) {
        all.push(...previous.items);
        continue;
      }

      const revision = (previous?.revision ?? 0) + 1;
      let message = notice;
      let items: LocalItem[] = [];

      if (patch) {
        try {
          items = parsePatchFiles(patch)
            .flatMap((entry) => entry.files)
            .map((fileDiff, index) => ({
              id: index === 0 ? file.id : JSON.stringify([file.checkout, file.path, index]),
              ownerId: file.id,
              type: "diff",
              fileDiff,
              version: revision,
            }));
        } catch {
          message = "This change could not be rendered as a text diff.";
        }
      }

      if (!items.length)
        items = [
          {
            id: file.id,
            ownerId: file.id,
            type: "file",
            version: revision,
            file: {
              name: file.path,
              contents: message,
              lang: "text",
              cacheKey: `${file.id}:${revision}`,
            },
          },
        ];
      cache.current.set(file.id, { patch, notice, revision, items });
      all.push(...items);
    }

    return all;
  }, [files]);

  const items = useMemo(
    () =>
      parsed.map((item) => ({
        ...item,
        version: (item.version ?? 0) * 2 + (collapsed.has(item.id) ? 1 : 0),
        collapsed: collapsed.has(item.id),
      })),
    [parsed, collapsed],
  );

  const byId = useMemo(() => {
    const owners = new Map(files.map((file) => [file.id, file]));

    return new Map(parsed.map((item) => [item.id, owners.get(item.ownerId)!]));
  }, [files, parsed]);

  const options = useMemo<StyledDiffCodeViewOptions<undefined>>(
    () => ({
      theme: mode === "dark" ? "pierre-dark" : "pierre-light",
      themeType: mode,
      diffStyle: style,
      overflow: wrap ? "wrap" : "scroll",
      diffIndicators: "classic",
      hunkSeparators: "line-info",
      enableLineSelection: true,
      lineHoverHighlight: "both",
    }),
    [mode, style, wrap],
  );

  function toggle(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  }

  function reveal(checkout: string, path: string) {
    const id = localFileId(checkout, path);
    setSelection({ checkout, path });
    setCollapsed((previous) => {
      const next = new Set(previous);
      next.delete(id);

      return next;
    });
    viewer.current?.clearSelectedLines();
    requestAnimationFrame(() => viewer.current?.scrollTo({ type: "item", id, align: "start" }));
  }

  const allFilesCollapsed = items.length > 0 && items.every((item) => collapsed.has(item.id));

  const active =
    selection && byId.has(localFileId(selection.checkout, selection.path))
      ? selection
      : (files[0] ?? null);

  return {
    viewer,
    items,
    options,
    mode,
    active,
    reveal,
    display: {
      style,
      setStyle,
      wrap,
      setWrap,
      allFilesCollapsed,
      toggleAllFiles: () =>
        setCollapsed(allFilesCollapsed ? new Set() : new Set(items.map((item) => item.id))),
    },
    header: (item: CodeViewItem<undefined>) => (
      <button
        className="px-2 text-muted-foreground"
        aria-label={`${collapsed.has(item.id) ? "Expand" : "Collapse"} ${byId.get(item.id)?.path}`}
        onClick={() => toggle(item.id)}
      >
        {collapsed.has(item.id) ? "▸" : "▾"}
      </button>
    ),
    suffix: (item: CodeViewItem<undefined>) => (
      <span
        className="truncate px-2 text-xs text-muted-foreground"
        title={byId.get(item.id)?.checkout}
      >
        {byId.get(item.id)?.label}
      </span>
    ),
  };
}
