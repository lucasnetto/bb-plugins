import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function ResizableFilesSidebar({
  width,
  onWidthChange,
  children,
}: {
  width: number | null;
  onWidthChange: (width: number | null) => void;
  children: ReactNode;
}) {
  const id = useId();
  const sidebar = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [size, setSize] = useState({ width: 288, available: 1000 });
  useEffect(() => {
    const element = sidebar.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const observer = new ResizeObserver(() =>
      setSize({
        width: element.getBoundingClientRect().width,
        available: parent.getBoundingClientRect().width,
      }),
    );
    observer.observe(element);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  function resize(next: number) {
    const available = sidebar.current?.parentElement?.getBoundingClientRect().width;
    if (!available) return;
    onWidthChange(Math.max(Math.min(144, available * 0.7), Math.min(next, available * 0.7)));
  }

  return (
    <aside
      ref={sidebar}
      id={id}
      aria-label="Files sidebar"
      className="relative flex min-h-0 min-w-0 shrink-0 border-l border-border"
      style={{ width: width ?? "clamp(144px, 35%, 288px)", maxWidth: "70%" }}
    >
      <div
        role="separator"
        aria-label="Resize files section"
        aria-orientation="vertical"
        aria-controls={id}
        aria-valuemin={Math.round(Math.min(144, size.available * 0.7))}
        aria-valuemax={Math.round(size.available * 0.7)}
        aria-valuenow={Math.round(size.width)}
        aria-valuetext={`${Math.round(size.width)} pixels`}
        tabIndex={0}
        title="Drag to resize files. Use arrow keys to resize; double-click to reset."
        className="absolute inset-y-0 -left-1 z-10 w-2 touch-none cursor-col-resize select-none hover:bg-ring/40 focus-visible:bg-ring/40 focus-visible:outline-none active:bg-ring/60"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            width: sidebar.current?.getBoundingClientRect().width ?? 288,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start?.pointerId === event.pointerId) resize(start.width + start.x - event.clientX);
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onDoubleClick={() => onWidthChange(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home")
            return;
          event.preventDefault();
          if (event.key === "Home") onWidthChange(null);
          else
            resize(
              (sidebar.current?.getBoundingClientRect().width ?? 288) +
                (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 48 : 16),
            );
        }}
      />
      {children}
    </aside>
  );
}
