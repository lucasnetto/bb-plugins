import { useEffect, useState } from "react";
import type { SnoozedMap } from "@/shared/snooze-contract";

/** One clock for labels and exact snooze deadlines; refresh after backgrounding. */
export function useSidebarClock(snoozed: SnoozedMap): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number;

    const tick = () => {
      const current = Date.now();
      setNow(current);

      const nextWake = Math.min(
        ...Object.values(snoozed).map(({ until }) => (until > current ? until : Infinity)),
      );

      window.clearTimeout(timer);
      timer = window.setTimeout(tick, Math.min(60_000, nextWake - current));
    };

    tick();
    window.addEventListener("focus", tick);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", tick);
    };
  }, [snoozed]);

  return now;
}
