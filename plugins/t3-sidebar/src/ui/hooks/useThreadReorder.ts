import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Drop = { source: string; target: string; after: boolean; group: string };

/** Pointer gestures coexist with BB's split handler, which starts outside the sidebar. */
export function useThreadReorder(onDrop: (drop: Drop) => void) {
  const listRef = useRef<HTMLUListElement>(null);
  const cleanup = useRef<() => void>(() => {});
  const callback = useRef(onDrop);
  callback.current = onDrop;
  const [preview, setPreview] = useState<Drop | null>(null);
  useEffect(() => () => cleanup.current(), []);

  function onPointerDown(event: ReactPointerEvent, source: string, group: string) {
    if (
      event.button !== 0 ||
      event.pointerType === "touch" ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;

    if (
      !(event.target instanceof Element) ||
      event.target.closest("button, input, textarea, [contenteditable=true]")
    )
      return;

    if (!listRef.current) return;
    const root = listRef.current;
    cleanup.current();
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    let started = false;
    let finished = false;
    let drop: Drop | null = null;
    let lastY = startY;
    let frame = 0;
    let scrollParent: HTMLElement | null = root.parentElement;

    while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY))
      scrollParent = scrollParent.parentElement;

    const blockClick = (click: MouseEvent) => {
      click.preventDefault();
      click.stopImmediatePropagation();
    };

    let clickTimer: ReturnType<typeof setTimeout> | undefined;

    const removeClickBlock = () => {
      window.removeEventListener("click", blockClick, true);
      clearTimeout(clickTimer);
      window.removeEventListener("pointerup", releaseClickBlock);
      window.removeEventListener("pointerdown", removeClickBlock, true);
    };

    const releaseClickBlock = () => {
      clickTimer = setTimeout(removeClickBlock, 0);
    };

    const clear = () => {
      finished = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      cancelAnimationFrame(frame);
      setPreview(null);
    };

    const cancel = () => {
      clear();

      if (started) {
        window.addEventListener("pointerup", releaseClickBlock, { once: true });
        window.addEventListener("pointerdown", removeClickBlock, { once: true, capture: true });
      }
    };

    const updateTarget = () => {
      const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-reorder-id]")).filter(
        (row) => row.dataset.reorderGroup === group,
      );

      if (!rows.some((row) => row.dataset.reorderId === source)) {
        cancel();

        return;
      }

      if (
        lastY < rows[0]!.getBoundingClientRect().top ||
        lastY > rows.at(-1)!.getBoundingClientRect().bottom
      ) {
        drop = null;
        setPreview(null);

        return;
      }

      const target = rows.find((row) => lastY <= row.getBoundingClientRect().bottom) ?? rows.at(-1);

      if (!target) return;
      const bounds = target.getBoundingClientRect();
      drop = {
        source,
        target: target.dataset.reorderId!,
        after: lastY > bounds.top + bounds.height / 2,
        group,
      };
      setPreview(drop);
    };

    const scroll = () => {
      if (scrollParent) {
        const bounds = scrollParent.getBoundingClientRect();
        const delta = lastY < bounds.top + 36 ? -10 : lastY > bounds.bottom - 36 ? 10 : 0;

        if (delta) {
          scrollParent.scrollTop += delta;
          updateTarget();
        }
      }

      if (!finished) frame = requestAnimationFrame(scroll);
    };

    function move(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      const bounds = root.getBoundingClientRect();

      // Relinquish the gesture permanently so the host can complete a split drag.
      if (e.clientX < bounds.left || e.clientX > bounds.right) {
        cancel();

        return;
      }

      if (!started && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;

      if (!started) {
        started = true;
        window.addEventListener("click", blockClick, true);
        frame = requestAnimationFrame(scroll);
      }

      e.preventDefault();
      lastY = e.clientY;
      updateTarget();
    }

    function up(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      clear();

      if (started) {
        clickTimer = setTimeout(removeClickBlock, 0);

        if (drop && drop.source !== drop.target) callback.current(drop);
      }
    }

    function key(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    cleanup.current = () => {
      clear();
      removeClickBlock();
    };
  }

  return { listRef, preview, onPointerDown };
}
