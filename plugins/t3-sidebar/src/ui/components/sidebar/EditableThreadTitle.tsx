import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/ui/lib/utils";

/** Inline rename: row double-click, F2 and the context menu all start the same edit. */
export function useThreadRename(title: string, onRename: (title: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (draft !== null) inputRef.current?.select();
  }, [draft]);
  const commit = useCallback(() => {
    if (draft === null) return;
    const next = draft.trim();
    if (next !== "" && next !== title) onRename(next);
    setDraft(null);
  }, [draft, title, onRename]);
  return {
    draft,
    setDraft,
    inputRef,
    commit,
    start: () => setDraft(title),
    cancel: () => setDraft(null),
  };
}

export function EditableThreadTitle({
  rename,
  title,
  recede,
  isCard,
  isActive,
  isUnread,
}: {
  rename: ReturnType<typeof useThreadRename>;
  title: string;
  recede: boolean;
  isCard: boolean;
  isActive: boolean;
  isUnread: boolean;
}) {
  const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();

  return rename.draft !== null ? (
    <input
      ref={rename.inputRef}
      autoFocus
      value={rename.draft}
      aria-label="Thread title"
      onChange={(event) => rename.setDraft(event.target.value)}
      onBlur={rename.commit}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") rename.commit();
        if (event.key === "Escape") rename.cancel();
      }}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  ) : (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm",
        recede ? "font-normal" : "font-medium",
        isCard
          ? isUnread
            ? "text-foreground"
            : recede
              ? "text-muted-foreground"
              : "text-foreground/90"
          : cn(
              "group-hover/row:text-foreground",
              isActive
                ? "text-foreground"
                : isUnread
                  ? "text-muted-foreground"
                  : "text-muted-foreground/70",
            ),
      )}
    >
      {title}
    </span>
  );
}
